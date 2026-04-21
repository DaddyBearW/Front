const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const express = require("express");
const cors = require("cors");
const webpush = require("web-push");
const { Server } = require("socket.io");

const PORT = 3001;
const ROOT = __dirname;
const VAPID_FILE = path.join(ROOT, "vapid-keys.json");
const CERT_FILE = path.join(ROOT, "localhost.pem");
const KEY_FILE = path.join(ROOT, "localhost-key.pem");

function getVapidKeys() {
  if (fs.existsSync(VAPID_FILE)) {
    return JSON.parse(fs.readFileSync(VAPID_FILE, "utf8"));
  }

  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
  return keys;
}

const vapidKeys = getVapidKeys();

webpush.setVapidDetails(
  "mailto:student@example.com",
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  const blockedFiles = ["/vapid-keys.json", "/localhost.pem", "/localhost-key.pem"];

  if (blockedFiles.includes(req.path)) {
    res.status(404).end();
    return;
  }

  next();
});
app.use(express.static(ROOT));

const subscriptions = new Map();
const reminders = new Map();

function normalizeText(text) {
  return String(text || "").trim().toLowerCase();
}

function removeSubscription(endpoint) {
  subscriptions.delete(endpoint);
}

async function sendPushToAll(payload) {
  const message = JSON.stringify(payload);
  const tasks = [];

  for (const subscription of subscriptions.values()) {
    const task = webpush.sendNotification(subscription, message).catch((error) => {
      const statusCode = error.statusCode || 0;
      if (statusCode === 404 || statusCode === 410) {
        removeSubscription(subscription.endpoint);
      }
      console.error("Push error:", error.message);
    });

    tasks.push(task);
  }

  await Promise.all(tasks);
}

function scheduleReminder(reminderId, text, reminderTime) {
  const delay = reminderTime - Date.now();

  if (delay <= 0) {
    return false;
  }

  const oldReminder = reminders.get(reminderId);
  if (oldReminder) {
    clearTimeout(oldReminder.timeoutId);
  }

  const timeoutId = setTimeout(async () => {
    await sendPushToAll({
      title: "Напоминание",
      body: text,
      reminderId
    });

    reminders.delete(reminderId);
  }, delay);

  reminders.set(reminderId, {
    timeoutId,
    text,
    reminderTime
  });

  return true;
}

app.get("/api/vapid-public-key", (req, res) => {
  res.type("text/plain").send(vapidKeys.publicKey);
});

app.post("/subscribe", (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    res.status(400).json({ message: "Некорректная подписка" });
    return;
  }

  subscriptions.set(subscription.endpoint, subscription);
  res.status(201).json({ message: "Подписка сохранена" });
});

app.post("/unsubscribe", (req, res) => {
  const endpoint = req.body ? req.body.endpoint : null;

  if (!endpoint) {
    res.status(400).json({ message: "Не передан endpoint" });
    return;
  }

  removeSubscription(endpoint);
  res.json({ message: "Подписка удалена" });
});

app.post("/api/clear-reminders", (req, res) => {
  const texts = Array.isArray(req.body.texts) ? req.body.texts.map(normalizeText) : [];
  let deletedCount = 0;

  for (const [id, reminder] of reminders.entries()) {
    if (texts.includes(normalizeText(reminder.text))) {
      clearTimeout(reminder.timeoutId);
      reminders.delete(id);
      deletedCount += 1;
    }
  }

  res.json({ deletedCount });
});

app.post("/snooze", (req, res) => {
  const reminderId = Number(req.query.reminderId);

  if (!reminderId || !reminders.has(reminderId)) {
    res.status(404).json({ message: "Напоминание не найдено" });
    return;
  }

  const reminder = reminders.get(reminderId);
  clearTimeout(reminder.timeoutId);

  const newReminderTime = Date.now() + 5 * 60 * 1000;
  scheduleReminder(reminderId, reminder.text, newReminderTime);

  res.json({ message: "Напоминание отложено на 5 минут" });
});

function createWebServer() {
  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
    const cert = fs.readFileSync(CERT_FILE);
    const key = fs.readFileSync(KEY_FILE);

    return {
      protocol: "https",
      server: https.createServer({ cert, key }, app)
    };
  }

  return {
    protocol: "http",
    server: http.createServer(app)
  };
}

function startServer() {
  const { protocol, server } = createWebServer();
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on("connection", (socket) => {
    console.log("Клиент подключён:", socket.id);

    socket.on("newTask", async (task) => {
      const text = String(task && task.text ? task.text : "").trim();
      if (!text) {
        return;
      }

      io.emit("taskAdded", {
        text,
        socketId: socket.id
      });

      await sendPushToAll({
        title: "Новая заметка",
        body: text
      });
    });

    socket.on("newReminder", (reminder) => {
      const reminderId = Number(reminder && reminder.id);
      const text = String(reminder && reminder.text ? reminder.text : "").trim();
      const reminderTime = Number(reminder && reminder.reminderTime);

      if (!reminderId || !text || !reminderTime) {
        return;
      }

      const saved = scheduleReminder(reminderId, text, reminderTime);
      if (!saved) {
        return;
      }

      io.emit("taskAdded", {
        text,
        socketId: socket.id,
        isReminder: true
      });
    });

    socket.on("disconnect", () => {
      console.log("Клиент отключён:", socket.id);
    });
  });

  server.listen(PORT, () => {
    console.log(`Сервер запущен на ${protocol}://localhost:${PORT}`);

    if (protocol === "https") {
      console.log("HTTPS включён. Сертификаты найдены в корне проекта.");
    } else {
      console.log("HTTPS не включён. Если нужны сертификаты, добавьте localhost.pem и localhost-key.pem.");
    }
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer
};
