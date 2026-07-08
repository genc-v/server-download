import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchWithTimeout(url, init = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/* ------------------------------------------------------------------ */
/* Gofile — ported from hydra src/main/services/hosters/gofile.ts      */
/* ------------------------------------------------------------------ */

const gofile = {
  language: "en-US",
  wtScriptUrl: "https://gofile.io/dist/js/wt.obf.js",
  alternateCdnBaseUrl: "https://gofilecdn.eu.cc",
  pageSize: 1000,
  tokenCachePath: path.join(__dirname, "..", "..", ".gofile-guest-token.json"),
  token: undefined,
  wtSecret: undefined,

  baseHeaders(accountToken) {
    const headers = {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      Origin: "https://gofile.io",
      Referer: "https://gofile.io/",
    };
    if (accountToken) headers.Authorization = `Bearer ${accountToken}`;
    return headers;
  },

  // Gofile's API requires an X-Website-Token header derived from a secret
  // embedded in their obfuscated wt.obf.js. We run that script in a vm
  // sandbox with a stubbed sha256 to capture the raw hash input and pull
  // the secret out of it.
  extractWtSecret(script) {
    let rawHashInput;
    const probeUserAgent = "ProbeUserAgent";
    const probeLanguage = "ProbeLanguage";
    const probeToken = "ProbeToken";
    const navigator = { userAgent: probeUserAgent, language: probeLanguage };
    const context = vm.createContext({
      appdata: {},
      crypto: crypto.webcrypto,
      console: { error() {}, log() {}, warn() {} },
      Date,
      Math,
      navigator,
      URLSearchParams,
      window: {
        crypto: crypto.webcrypto,
        location: { hostname: "gofile.io", search: "" },
        navigator,
      },
    });

    vm.runInContext(script, context, { timeout: 1000 });

    if (typeof context.generateWT !== "function") {
      throw new Error("Gofile WT generator was not found");
    }

    context._sha256 = (input) => {
      rawHashInput = String(input);
      return "0".repeat(64);
    };

    vm.runInContext(`generateWT(${JSON.stringify(probeToken)})`, context, {
      timeout: 1000,
    });

    if (!rawHashInput) {
      throw new Error("Gofile WT generator did not hash any input");
    }

    const expectedPrefix = `${probeUserAgent}::${probeLanguage}::${probeToken}::`;
    if (!rawHashInput.startsWith(expectedPrefix)) {
      throw new Error("Gofile WT generator format is unsupported");
    }

    const [, ...secretParts] = rawHashInput
      .slice(expectedPrefix.length)
      .split("::");
    const secret = secretParts.join("::").trim();
    if (!secret) throw new Error("Gofile WT secret was empty");
    return secret;
  },

  async getWtSecret() {
    if (this.wtSecret) return this.wtSecret;
    const response = await fetchWithTimeout(this.wtScriptUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/javascript, text/javascript, */*;q=0.8",
        Referer: "https://gofile.io/",
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to load Gofile WT script: ${response.status}`);
    }
    this.wtSecret = this.extractWtSecret(await response.text());
    return this.wtSecret;
  },

  async websiteToken(accountToken) {
    const secret = await this.getWtSecret();
    const timeSlot = Math.floor(Date.now() / 1000 / 14400);
    const raw = `${USER_AGENT}::${this.language}::${accountToken}::${timeSlot}::${secret}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  },

  async authorize(forceRefresh = false) {
    const configured = process.env.GOFILE_TOKEN?.trim();
    if (configured) return (this.token = configured);
    if (!forceRefresh && this.token) return this.token;

    if (!forceRefresh) {
      try {
        const cached = JSON.parse(
          await fs.readFile(this.tokenCachePath, "utf-8")
        );
        if (cached.token) return (this.token = cached.token);
      } catch {
        /* no cache yet */
      }
    }

    const headers = {
      ...this.baseHeaders(),
      "X-Website-Token": await this.websiteToken(""),
      "X-BL": this.language,
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetchWithTimeout("https://api.gofile.io/accounts", {
        method: "POST",
        headers,
      });
      const payload = await response.json();
      if (payload.status === "ok" && payload.data?.token) {
        this.token = payload.data.token;
        await fs
          .writeFile(
            this.tokenCachePath,
            JSON.stringify({ token: this.token, createdAt: Date.now() })
          )
          .catch(() => {});
        return this.token;
      }
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
        continue;
      }
      throw new Error(
        `Gofile account creation failed: ${payload.status ?? response.status}`
      );
    }
    throw new Error("Gofile account creation failed after all retries");
  },

  hashPassword(password) {
    const trimmed = password.trim();
    if (/^[a-f0-9]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
    return crypto.createHash("sha256").update(trimmed).digest("hex");
  },

  async getContentPage(id, accountToken, page, password) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(this.pageSize),
      sortField: "createTime",
      sortDirection: "-1",
    });
    if (password) params.set("password", this.hashPassword(password));

    const response = await fetchWithTimeout(
      `https://api.gofile.io/contents/${id}?${params}`,
      {
        headers: {
          ...this.baseHeaders(accountToken),
          "X-Website-Token": await this.websiteToken(accountToken),
          "X-BL": this.language,
        },
      }
    );
    const payload = await response.json();

    if (payload.status === "error-rateLimit" || response.status === 429) {
      throw new Error(
        "Gofile rate limit reached. Try again in a few minutes (or use a VPN)."
      );
    }
    if (payload.status !== "ok" || !payload.data) {
      throw new Error(`Gofile API returned ${payload.status} for ${id}`);
    }
    if (payload.data.canAccess === false) {
      throw new Error(
        payload.data.password
          ? `Gofile content ${id} is password protected or the password is wrong`
          : `Gofile content ${id} is not accessible`
      );
    }
    return payload;
  },

  async findFirstFileLink(id, accountToken, password, visited = new Set()) {
    if (visited.has(id)) return null;
    visited.add(id);

    const firstPage = await this.getContentPage(id, accountToken, 1, password);
    const totalPages = Math.max(1, firstPage.metadata?.totalPages ?? 1);
    const pages = [firstPage.data];
    for (let page = 2; page <= totalPages; page += 1) {
      pages.push(
        (await this.getContentPage(id, accountToken, page, password)).data
      );
    }

    for (const content of pages) {
      if (content.type === "file") return content.link ?? null;
      if (content.type !== "folder") throw new Error("Unsupported content type");

      for (const child of Object.values(content.children ?? {})) {
        if (child.type === "file" && child.link) return child.link;
        if (child.type === "folder" && child.canAccess !== false) {
          const nested = await this.findFirstFileLink(
            child.id,
            accountToken,
            password,
            visited
          );
          if (nested) return nested;
        }
      }
    }
    return null;
  },

  parseUri(uri) {
    const url = new URL(uri);
    const segments = url.pathname.split("/").filter(Boolean);
    const id = segments[segments.length - 1];
    const password = url.searchParams.get("password") ?? undefined;
    return { id, password };
  },

  async resolve(uri, password) {
    const { id, password: uriPassword } = this.parseUri(uri);
    if (!id) throw new Error("Invalid Gofile URL");
    const effectivePassword = password || uriPassword;

    // Alternate CDN fast path, same probe hydra does.
    try {
      const probe = await fetchWithTimeout(
        `${this.alternateCdnBaseUrl}/${encodeURIComponent(id)}`,
        { method: "OPTIONS" }
      );
      if (probe.ok) {
        return {
          url: `${this.alternateCdnBaseUrl}/${encodeURIComponent(id)}`,
          headers: {},
        };
      }
    } catch {
      /* fall back to official flow */
    }

    let token = await this.authorize();
    let link;
    try {
      link = await this.findFirstFileLink(id, token, effectivePassword);
    } catch (error) {
      const message = String(error.message ?? "").toLowerCase();
      const authError =
        message.includes("wrongtoken") ||
        message.includes("notauthenticated") ||
        message.includes("notpremium");
      if (process.env.GOFILE_TOKEN || !authError) throw error;
      token = await this.authorize(true);
      link = await this.findFirstFileLink(id, token, effectivePassword);
    }

    if (!link) throw new Error("No file links found in Gofile contents");
    return {
      url: link,
      headers: {
        Cookie: `accountToken=${token}`,
        "User-Agent": USER_AGENT,
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* Datanodes — ported from hydra src/main/services/hosters/datanodes.ts */
/* ------------------------------------------------------------------ */

const datanodes = {
  async resolve(uri) {
    const parsedUrl = new URL(uri);
    const fileCode = parsedUrl.pathname.split("/").filter(Boolean)[0];
    if (!fileCode) throw new Error("Invalid Datanodes URL");

    const formData = new FormData();
    formData.append("op", "download2");
    formData.append("id", fileCode);
    formData.append("rand", "");
    formData.append("referer", "https://datanodes.to/download");
    formData.append("method_free", "Free Download >>");
    formData.append("method_premium", "");
    formData.append("__dl", "1");
    formData.append("g_captch__a", "1");

    const response = await fetchWithTimeout(
      "https://datanodes.to/download",
      {
        method: "POST",
        body: formData,
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.9",
          Cookie: "lang=english",
          Referer: "https://datanodes.to/download",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
        },
      },
      30000
    );

    const data = await response.json().catch(() => null);
    if (data && typeof data === "object" && data.url) {
      return { url: decodeURIComponent(data.url), headers: {} };
    }
    throw new Error("Failed to get the Datanodes download link");
  },
};

/* ------------------------------------------------------------------ */
/* VikingFile — needs hydra's private unlock backend (NIMBUS_API_URL)  */
/* ------------------------------------------------------------------ */

const vikingfile = {
  async resolve(uri) {
    const nimbusApiUrl = process.env.NIMBUS_API_URL?.trim();
    if (!nimbusApiUrl) {
      throw new Error(
        "VikingFile links require the NIMBUS_API_URL environment variable (hydra's private unlock backend)"
      );
    }

    const response = await fetchWithTimeout(`${nimbusApiUrl}/hosters/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: uri }),
    });
    const data = await response.json().catch(() => null);
    if (!data?.link) throw new Error("Failed to unlock VikingFile URL");

    // Follow one redirect to the final CDN URL, like hydra does.
    try {
      const redirect = await fetchWithTimeout(data.link, {
        method: "HEAD",
        redirect: "manual",
      });
      const location = redirect.headers.get("location");
      if (location) return { url: location, headers: {} };
    } catch {
      /* use the unlock link directly */
    }
    return { url: data.link, headers: {} };
  },
};

/* ------------------------------------------------------------------ */
/* 1fichier — official API, requires a Premium/Access API key          */
/* ------------------------------------------------------------------ */

const fichier = {
  async resolve(uri) {
    const apiKey = process.env.FICHIER_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "1fichier links require the FICHIER_API_KEY environment variable (Premium account API key)"
      );
    }

    const response = await fetchWithTimeout(
      "https://api.1fichier.com/v1/download/get_token.cgi",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: uri }),
      }
    );
    const data = await response.json().catch(() => null);
    if (data?.status === "OK" && data.url) {
      return { url: data.url, headers: {} };
    }
    throw new Error(
      `1fichier API error: ${data?.message ?? `HTTP ${response.status}`}`
    );
  },
};

/* ------------------------------------------------------------------ */

export function hosterForUri(uri) {
  if (uri.startsWith("https://gofile.io")) return "gofile";
  if (uri.startsWith("https://datanodes.to")) return "datanodes";
  if (
    uri.startsWith("https://vikingfile.com") ||
    uri.startsWith("https://vik1ngfile.site")
  ) {
    return "vikingfile";
  }
  if (uri.startsWith("https://1fichier.com")) return "1fichier";
  if (uri.startsWith("http://") || uri.startsWith("https://")) return "direct";
  return null;
}

// Returns { url, headers } — a direct URL the generic downloader can stream.
export async function resolveDownload(uri, password) {
  switch (hosterForUri(uri)) {
    case "gofile":
      return gofile.resolve(uri, password);
    case "datanodes":
      return datanodes.resolve(uri);
    case "vikingfile":
      return vikingfile.resolve(uri);
    case "1fichier":
      return fichier.resolve(uri);
    case "direct":
      return { url: uri, headers: { "User-Agent": USER_AGENT } };
    default:
      throw new Error("Unsupported URL");
  }
}
