/**
 * CLOUDFLARE WORKER: Pichost Backend (Now with Google Auth)
 */

const getCorsHeaders = (request) => {
  const origin = request.headers.get("Origin") || "http://localhost";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Cookie",
    "Access-Control-Allow-Credentials": "true",
  };
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }

    let response;

    try {
      // ROUTES
      if (path === "/register" && request.method === "POST") response = await register(request, env);
      else if (path === "/login" && request.method === "POST") response = await login(request, env);
      else if (path === "/google-login" && request.method === "POST") response = await googleLogin(request, env);
      else if (path === "/logout") response = await logout();
      else if (path === "/me" && request.method === "GET") response = await getMe(request, env);
      else if (path === "/upload" && request.method === "POST") response = await uploadImage(request, env);
      else if (path === "/list") response = await listImages(request, env);
      else if (path.startsWith("/raw/")) response = await rawImage(path.split("/")[2], env);
      else if (path.startsWith("/delete/")) response = await deleteImage(path.split("/")[2], request, env);
      else if (path.startsWith("/download/")) response = await downloadImage(path.split("/")[2], env);
      else response = new Response("API OK", { status: 200 });
    } catch (e) {
      response = new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }

    // Inject CORS headers
    const finalResponse = new Response(response.body, response);
    const headers = getCorsHeaders(request);
    Object.entries(headers).forEach(([key, value]) => finalResponse.headers.set(key, value));
    
    return finalResponse;
  }
};

// --- UTILITIES ---

function randomID() { return crypto.randomUUID().slice(0, 8); }

function getSessionUser(request) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/session=([^;]+)/);
  return m ? m[1] : null;
}

async function hashPassword(password) {
  const enc = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return[...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// --- HANDLERS ---

async function getMe(request, env) {
  const username = getSessionUser(request);
  if (!username) return new Response("Unauthorized", { status: 401 });

  const userData = await env.IMG_KV.get(`user:${username}`);
  if (!userData) return new Response("User not found", { status: 404 });

  const user = JSON.parse(userData);

  // Return formatted user profile
  const profile = {
    username: username,
    name: user.name || username,
    email: user.email || "Standard Account",
    picture: user.picture || null,
    isGoogle: !!user.google
  };

  return new Response(JSON.stringify(profile), {
    headers: { "Content-Type": "application/json" }
  });
}

async function googleLogin(request, env) {
  try {
    const { token } = await request.json();
    if (!token) return new Response("No token provided", { status: 400 });

    // Verify token with Google
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
    const googleData = await googleRes.json();

    if (!googleRes.ok || !googleData.sub) {
      return new Response("Invalid Google Token", { status: 401 });
    }

    const { sub, email, picture, name } = googleData;
    const internalUsername = `google_${sub}`;

    // Check if user exists in KV, if not, create them
    const existing = await env.IMG_KV.get(`user:${internalUsername}`);
    if (!existing) {
      await env.IMG_KV.put(`user:${internalUsername}`, JSON.stringify({
        google: true,
        email: email,
        picture: picture,
        name: name,
        created: Date.now()
      }));
    }

    // Issue standard session cookie
    return new Response(JSON.stringify({ success: true, email, picture, name }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `session=${internalUsername}; Path=/; HttpOnly; Max-Age=86400; Secure; SameSite=None`
      }
    });

  } catch (e) {
    return new Response("Google Login Failed", { status: 500 });
  }
}

async function register(request, env) {
  const form = await request.formData().catch(() => null);
  if (!form) return new Response("Invalid form data", { status: 400 });

  const username = form.get("username");
  const password = form.get("password");
  
  if (!username || !password || username.length < 3 || password.length < 4) {
    return new Response("Username/Password too short", { status: 400 });
  }

  const existing = await env.IMG_KV.get(`user:${username}`);
  if (existing) return new Response("User already exists", { status: 409 });

  const passHash = await hashPassword(password);
  await env.IMG_KV.put(`user:${username}`, JSON.stringify({ password: passHash, created: Date.now() }));
  return new Response("User created", { status: 201 });
}

async function login(request, env) {
  const form = await request.formData().catch(() => null);
  if (!form) return new Response("Invalid form data", { status: 400 });

  const username = form.get("username");
  const password = form.get("password");

  const userData = await env.IMG_KV.get(`user:${username}`);
  if (!userData) return new Response("User not found", { status: 401 });

  try {
    const user = JSON.parse(userData);
    if(user.google) return new Response("Please sign in with Google", { status: 400 });

    const passHash = await hashPassword(password);
    if (passHash !== user.password) return new Response("Wrong password", { status: 401 });

    return new Response(JSON.stringify({ success: true, username }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `session=${username}; Path=/; HttpOnly; Max-Age=86400; Secure; SameSite=None`
      }
    });
  } catch(e) {
    return new Response("Corrupted user data", { status: 500 });
  }
}

async function logout() {
  return new Response(JSON.stringify({ success: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": "session=; Path=/; Max-Age=0; Secure; SameSite=None" 
    }
  });
}

// ... (KEEP uploadImage, listImages, getTelegramURL, rawImage, deleteImage, downloadImage EXACTLY as they were previously)

async function uploadImage(request, env) {
  const user = getSessionUser(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form ? form.get("file") : null;
  if (!file || !file.name) return new Response("No file provided", { status: 400 });

  const tgForm = new FormData();
  tgForm.append("chat_id", env.TELEGRAM_CHAT_ID);
  tgForm.append("photo", file);

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: "POST", body: tgForm
    });
    const tgData = await tgRes.json();
    
    if (!tgData.ok) return new Response(`Telegram Error: ${tgData.description}`, { status: 500 });

    const id = randomID();
    await env.IMG_KV.put(`img:${id}`, JSON.stringify({
      file_id: tgData.result.photo.pop().file_id,
      message_id: tgData.result.message_id,
      owner: user,
      uploaded: Date.now()
    }));

    return new Response(JSON.stringify({ id, raw: `/raw/${id}` }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch(e) {
    return new Response("Upload failed", { status: 500 });
  }
}

async function listImages(request, env) {
  const user = getSessionUser(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  try {
    const list = await env.IMG_KV.list({ prefix: "img:", limit: 1000 });
    const results =[];
    
    for (const key of list.keys) {
      const data = await env.IMG_KV.get(key.name);
      if (data) {
        try {
          const meta = JSON.parse(data);
          if (meta.owner === user) {
            const id = key.name.replace("img:", "");
            results.push({ id, raw: `/raw/${id}`, timestamp: meta.uploaded });
          }
        } catch(e) {}
      }
    }
    
    results.sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" }
    });
  } catch(e) {
    return new Response("Failed to fetch list", { status: 500 });
  }
}

async function getTelegramURL(file_id, env) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${file_id}`);
  const j = await r.json();
  if(!j.ok) throw new Error("File not found on Telegram");
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${j.result.file_path}`;
}

async function rawImage(id, env) {
  const data = await env.IMG_KV.get(`img:${id}`);
  if (!data) return new Response("Not found", { status: 404 });
  
  try {
    const meta = JSON.parse(data);
    const url = await getTelegramURL(meta.file_id, env);
    const img = await fetch(url);
    return new Response(img.body, {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "public,max-age=86400" }
    });
  } catch(e) { return new Response("Image load error", { status: 500 }); }
}

async function deleteImage(id, request, env) {
  const user = getSessionUser(request);
  if (!user) return new Response("Unauthorized", { status: 401 });
  const data = await env.IMG_KV.get(`img:${id}`);
  if (!data) return new Response("Not found", { status: 404 });
  
  try {
    const meta = JSON.parse(data);
    if (meta.owner !== user) return new Response("Forbidden", { status: 403 });
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/deleteMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, message_id: meta.message_id })
    });
    await env.IMG_KV.delete(`img:${id}`);
    return new Response("Deleted", { status: 200 });
  } catch(e) { return new Response("Delete failed", { status: 500 }); }
}

async function downloadImage(id, env) {
  const data = await env.IMG_KV.get(`img:${id}`);
  if (!data) return new Response("Not found", { status: 404 });
  try {
    const meta = JSON.parse(data);
    const url = await getTelegramURL(meta.file_id, env);
    const img = await fetch(url);
    return new Response(img.body, {
      headers: { "Content-Disposition": `attachment; filename="Pichost_${id}.jpg"` }
    });
  } catch(e) { return new Response("Download failed", { status: 500 }); }
}
