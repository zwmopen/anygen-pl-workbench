import { BrowserWindow, shell, session } from "electron";

const ANYGEN_HOME_URL = "https://www.anygen.io/";
const ANYGEN_PARTITION = "persist:anygen-account";
const CHECK_IN_PATTERNS = [
  "签到",
  "签到领积分",
  "check in",
  "check-in",
  "daily reward",
  "daily rewards",
  "claim reward",
  "claim",
  "collect reward",
  "领取积分",
  "领取奖励"
];
const CREDIT_PATTERNS = [
  "积分",
  "credits",
  "credit balance",
  "remaining credits",
  "available credits",
  "余额"
];

let accountWindow = null;

export async function openAccountWindow(targetUrl = ANYGEN_HOME_URL) {
  const window = ensureAccountWindow({ show: true });
  await window.loadURL(targetUrl);
  window.show();
  window.focus();
  return { ok: true, url: targetUrl };
}

export async function getAccountSnapshot() {
  const cookies = await getAnyGenCookies();
  const sessionReady = cookies.length > 0;
  const snapshot = sessionReady ? await inspectAnyGenPortal() : buildEmptySnapshot();

  return {
    supported: true,
    sessionReady,
    cookieCount: cookies.length,
    ...snapshot
  };
}

export async function clearAccountSession() {
  const ses = getAnyGenSession();
  await ses.clearStorageData();
  const cookies = await getAnyGenCookies();

  if (accountWindow && !accountWindow.isDestroyed()) {
    await accountWindow.loadURL(ANYGEN_HOME_URL);
  }

  return {
    supported: true,
    sessionReady: cookies.length > 0
  };
}

export async function tryDailyCheckIn() {
  const cookies = await getAnyGenCookies();
  if (cookies.length === 0) {
    return {
      ok: false,
      sessionReady: false,
      status: "not_logged_in",
      message: "还没有网页登录态，先点“登录网页账号”完成登录。"
    };
  }

  const browser = ensureAccountWindow({ show: false });
  await browser.loadURL(ANYGEN_HOME_URL);
  await wait(1800);

  const clickResult = await browser.webContents.executeJavaScript(`
    (() => {
      const creditPatterns = ${JSON.stringify(CREDIT_PATTERNS)};
      const checkInPatterns = ${JSON.stringify(CHECK_IN_PATTERNS)};
      const elements = Array.from(document.querySelectorAll("button, a, [role='button'], [tabindex='0']"));
      const visible = elements.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      const mapCandidate = (element) => {
        const rect = element.getBoundingClientRect();
        const text = (element.innerText || element.textContent || "").trim();
        return {
          element,
          text,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom
        };
      };

      const scoreCreditTrigger = (candidate) => {
        const text = candidate.text.toLowerCase();
        let score = 0;
        if (creditPatterns.some((pattern) => text.includes(pattern.toLowerCase()))) {
          score += 100;
        }
        if (/(\\d+[\\d,.]*)\\s*(credits?|积分|pts|points)/i.test(candidate.text)) {
          score += 80;
        }
        if (candidate.top < 220) {
          score += 20;
        }
        if (candidate.left > window.innerWidth * 0.55) {
          score += 20;
        }
        score += Math.max(0, 30 - Math.round((window.innerWidth - candidate.right) / 20));
        score += Math.max(0, 20 - Math.round(candidate.top / 15));
        return score;
      };

      const creditCandidate = visible
        .map(mapCandidate)
        .filter((candidate) => candidate.text)
        .sort((left, right) => scoreCreditTrigger(right) - scoreCreditTrigger(left))[0];

      if (creditCandidate && scoreCreditTrigger(creditCandidate) >= 60) {
        creditCandidate.element.click();
      }

      const dialogs = Array.from(document.querySelectorAll("[role='dialog'], dialog, [data-state='open']"));
      const scopedElements = dialogs.length
        ? dialogs.flatMap((dialog) => Array.from(dialog.querySelectorAll("button, a, [role='button'], [tabindex='0']")))
        : visible;

      const checkInCandidate = scopedElements.find((element) => {
        const text = (element.innerText || element.textContent || "").trim().toLowerCase();
        return checkInPatterns.some((pattern) => text.includes(pattern.toLowerCase()));
      });

      if (!checkInCandidate) {
        return {
          clicked: false,
          stage: creditCandidate ? "credit_opened" : "credit_not_found",
          creditLabel: creditCandidate?.text || "",
          label: "",
          href: ""
        };
      }

      const label = (checkInCandidate.innerText || checkInCandidate.textContent || "").trim();
      const href = checkInCandidate.href || "";
      checkInCandidate.click();
      return {
        clicked: true,
        stage: creditCandidate ? "credit_then_checkin" : "direct_checkin",
        creditLabel: creditCandidate?.text || "",
        label,
        href
      };
    })();
  `, true);

  await wait(1600);
  const snapshot = await inspectWindowSnapshot(browser);

  if (!clickResult?.clicked) {
    return {
      ok: false,
      sessionReady: true,
      status: "button_not_found",
      message: clickResult?.stage === "credit_not_found"
        ? "没有在右上角识别到积分入口，建议先手动登录并确认积分按钮可见。"
        : "点开积分区域后，还是没有识别到签到按钮，建议打开账号页手动看一下。",
      snapshot
    };
  }

  return {
    ok: true,
    sessionReady: true,
    status: "clicked",
    message: clickResult?.creditLabel
      ? `已尝试从“${clickResult.creditLabel}”进入并点击“${clickResult.label || "签到"}”。`
      : `已尝试点击“${clickResult.label || "签到"}”。`,
    actionLabel: clickResult.label || "",
    actionUrl: clickResult.href || "",
    snapshot
  };
}

export async function maybeAutoCheckIn(configStore) {
  const config = await configStore.getConfig();
  if (!config.account?.autoCheckIn) {
    return null;
  }

  const today = getLocalDateKey();
  if (config.account?.lastCheckInDate === today && config.account?.lastCheckInStatus === "success") {
    return null;
  }

  const result = await tryDailyCheckIn();
  await persistAccountState(configStore, result);
  return result;
}

export async function persistAccountState(configStore, result) {
  const snapshot = result?.snapshot || {};
  const successful = Boolean(result?.ok);
  const payload = {
    account: {
      lastCheckInAt: new Date().toISOString(),
      lastCheckInDate: getLocalDateKey(),
      lastCheckInStatus: successful ? "success" : (result?.status || "failed"),
      lastCheckInMessage: result?.message || "",
      sessionReady: Boolean(result?.sessionReady),
      lastCreditsText: snapshot.creditsText || "",
      lastCreditsObservedAt: snapshot.observedAt || "",
      lastDetectedLinks: snapshot.links || {},
      lastProfileLabel: snapshot.profileLabel || ""
    }
  };

  await configStore.updateConfig(payload);
}

function ensureAccountWindow({ show }) {
  if (accountWindow && !accountWindow.isDestroyed()) {
    if (show) {
      accountWindow.show();
      accountWindow.focus();
    }
    return accountWindow;
  }

  const parent = BrowserWindow.getAllWindows()[0] || null;
  accountWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 960,
    minHeight: 720,
    show,
    title: "AnyGen 账号",
    autoHideMenuBar: true,
    backgroundColor: "#eef2f7",
    parent,
    webPreferences: {
      partition: ANYGEN_PARTITION,
      contextIsolation: true,
      sandbox: false,
      spellcheck: false
    }
  });

  accountWindow.on("closed", () => {
    accountWindow = null;
  });

  accountWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAnyGenUrl(url)) {
      return { action: "allow" };
    }

    shell.openExternal(url);
    return { action: "deny" };
  });

  accountWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAnyGenUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  return accountWindow;
}

function getAnyGenSession() {
  return session.fromPartition(ANYGEN_PARTITION);
}

async function getAnyGenCookies() {
  const cookies = await getAnyGenSession().cookies.get({});
  return cookies.filter((cookie) => String(cookie.domain || "").includes("anygen.io"));
}

async function inspectAnyGenPortal() {
  const browser = ensureAccountWindow({ show: false });
  await browser.loadURL(ANYGEN_HOME_URL);
  await wait(1500);
  return await inspectWindowSnapshot(browser);
}

async function inspectWindowSnapshot(browser) {
  const snapshot = await browser.webContents.executeJavaScript(`
    (() => {
      const creditPatterns = ${JSON.stringify(CREDIT_PATTERNS)};
      const checkInPatterns = ${JSON.stringify(CHECK_IN_PATTERNS)};
      const bodyText = (document.body?.innerText || "").replace(/\\u00a0/g, " ");
      const lines = bodyText
        .split(/\\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 400);
      const clickable = Array.from(document.querySelectorAll("button, a, [role='button']"));
      const visible = clickable.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const detectLine = (patterns) => lines.find((line) => patterns.some((pattern) => line.toLowerCase().includes(pattern.toLowerCase()))) || "";
      const topRight = visible
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            text: (element.innerText || element.textContent || "").trim(),
            href: element.href || "",
            top: rect.top,
            right: window.innerWidth - rect.right,
            left: rect.left
          };
        })
        .filter((item) => item.text && item.top < 220 && item.left > window.innerWidth * 0.45)
        .sort((left, right) => left.top - right.top || left.right - right.right)
        .slice(0, 8);
      const detectLink = (patterns) => {
        const match = visible.find((element) => {
          const text = (element.innerText || element.textContent || "").trim().toLowerCase();
          return patterns.some((pattern) => text.includes(pattern.toLowerCase()));
        });
        return match ? {
          text: (match.innerText || match.textContent || "").trim(),
          href: match.href || ""
        } : null;
      };

      return {
        observedAt: new Date().toISOString(),
        creditsText: detectLine(creditPatterns),
        checkInText: detectLine(checkInPatterns),
        profileLabel: detectLine(["workspace", "dashboard", "我的", "profile", "account"]),
        topRightLabels: topRight,
        links: {
          credits: detectLink(["积分", "credits", "billing", "usage", "balance", "points"]),
          checkIn: detectLink(checkInPatterns),
          account: detectLink(["我的", "account", "profile", "workspace", "dashboard"])
        }
      };
    })();
  `, true);

  return snapshot || buildEmptySnapshot();
}

function buildEmptySnapshot() {
  return {
    observedAt: "",
    creditsText: "",
    checkInText: "",
    profileLabel: "",
    links: {
      credits: null,
      checkIn: null,
      account: null
    }
  };
}

function isAnyGenUrl(value) {
  return /^https?:\/\/([a-z0-9-]+\.)*anygen\.io(\/|$)/i.test(String(value || ""));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLocalDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
