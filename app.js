const contentDiv = document.getElementById("app-content");
const homeBtn = document.getElementById("home-btn");
const enablePushBtn = document.getElementById("enable-push");
const disablePushBtn = document.getElementById("disable-push");
const toast = document.getElementById("toast");

let socket = null;
const textsToDelete = ["жопа", "посрать"];

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

function setActiveButton(activeId) {
  [homeBtn].forEach((button) => button.classList.remove("active"));
  document.getElementById(activeId).classList.add("active");
}

async function loadContent(page) {
  try {
    const response = await fetch(`/content/${page}.html`);
    if (!response.ok) {
      throw new Error("Не удалось загрузить страницу");
    }

    const html = await response.text();
    contentDiv.innerHTML = html;

    if (page === "home") {
      initNotes();
    }
  } catch (error) {
    contentDiv.innerHTML = "<p>Не удалось загрузить страницу.</p>";
    console.error(error);
  }
}

function getNotes() {
  const notes = JSON.parse(localStorage.getItem("notes") || "[]");

  return notes.map((note) => {
    if (typeof note === "string") {
      return {
        id: Date.now() + Math.floor(Math.random() * 100000),
        text: note,
        reminder: null
      };
    }

    return {
      id: note.id || Date.now() + Math.floor(Math.random() * 100000),
      text: note.text || "",
      reminder: note.reminder || null
    };
  });
}

function saveNotes(notes) {
  localStorage.setItem("notes", JSON.stringify(notes));
}

function cleanOldNotes() {
  const notes = getNotes();
  const filteredNotes = notes.filter((note) => {
    const text = note.text.trim().toLowerCase();
    return !textsToDelete.includes(text);
  });

  if (filteredNotes.length !== notes.length) {
    saveNotes(filteredNotes);
  }

  fetch("/api/clear-reminders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      texts: textsToDelete
    })
  }).catch(() => {});
}

function renderNotes(list) {
  const notes = getNotes();

  if (!notes.length) {
    list.innerHTML = '<li class="empty-text">Пока заметок нет.</li>';
    return;
  }

  list.innerHTML = notes
    .map((note) => {
      let reminderHtml = "";

      if (note.reminder) {
        reminderHtml = `
          <div class="note-time">Напоминание: ${new Date(note.reminder).toLocaleString("ru-RU")}</div>
          <div class="note-badge">Есть напоминание</div>
        `;
      }

      return `
        <li class="note-item">
          <div class="note-text">${escapeHtml(note.text)}</div>
          ${reminderHtml}
        </li>
      `;
    })
    .join("");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function initNotes() {
  const form = document.getElementById("note-form");
  const input = document.getElementById("note-input");
  const reminderForm = document.getElementById("reminder-form");
  const reminderText = document.getElementById("reminder-text");
  const reminderTime = document.getElementById("reminder-time");
  const list = document.getElementById("notes-list");

  cleanOldNotes();
  renderNotes(list);

  function addNote(text, reminderTimestamp = null) {
    const notes = getNotes();
    const newNote = {
      id: Date.now(),
      text,
      reminder: reminderTimestamp
    };

    notes.push(newNote);
    saveNotes(notes);
    renderNotes(list);

    if (socket) {
      if (reminderTimestamp) {
        socket.emit("newReminder", {
          id: newNote.id,
          text: newNote.text,
          reminderTime: reminderTimestamp
        });
      } else {
        socket.emit("newTask", {
          text: newNote.text
        });
      }
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = input.value.trim();
    if (!text) {
      return;
    }

    addNote(text);
    input.value = "";
  });

  reminderForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = reminderText.value.trim();
    const datetime = reminderTime.value;

    if (!text || !datetime) {
      return;
    }

    const timestamp = new Date(datetime).getTime();
    if (timestamp <= Date.now()) {
      alert("Дата и время должны быть в будущем.");
      return;
    }

    addNote(text, timestamp);
    reminderText.value = "";
    reminderTime.value = "";
  });
}

function connectSocket() {
  if (!window.io) {
    return;
  }

  socket = io();

  socket.on("taskAdded", (task) => {
    if (socket && task.socketId === socket.id) {
      return;
    }

    if (task.isReminder) {
      showToast(`Добавлено напоминание: ${task.text}`);
      return;
    }

    showToast(`Новая заметка: ${task.text}`);
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

async function subscribeToPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    alert("Push-уведомления не поддерживаются в этом браузере.");
    return;
  }

  const publicKeyResponse = await fetch("/api/vapid-public-key");
  const publicKey = await publicKeyResponse.text();
  const registration = await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  await fetch("/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(subscription)
  });
}

async function unsubscribeFromPush() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    return;
  }

  await fetch("/unsubscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      endpoint: subscription.endpoint
    })
  });

  await subscription.unsubscribe();
}

async function setupPushButtons(registration) {
  if (!enablePushBtn || !disablePushBtn || !registration.pushManager) {
    return;
  }

  const subscription = await registration.pushManager.getSubscription();

  if (subscription) {
    enablePushBtn.classList.add("hidden");
    disablePushBtn.classList.remove("hidden");
  } else {
    enablePushBtn.classList.remove("hidden");
    disablePushBtn.classList.add("hidden");
  }

  enablePushBtn.addEventListener("click", async () => {
    if (Notification.permission === "denied") {
      alert("Уведомления запрещены в браузере.");
      return;
    }

    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        alert("Нужно разрешить уведомления.");
        return;
      }
    }

    await subscribeToPush();
    enablePushBtn.classList.add("hidden");
    disablePushBtn.classList.remove("hidden");
  });

  disablePushBtn.addEventListener("click", async () => {
    await unsubscribeFromPush();
    disablePushBtn.classList.add("hidden");
    enablePushBtn.classList.remove("hidden");
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    await setupPushButtons(registration);
    console.log("Service Worker зарегистрирован");
  } catch (error) {
    console.error("Ошибка регистрации Service Worker", error);
  }
}

homeBtn.addEventListener("click", () => {
  setActiveButton("home-btn");
  loadContent("home");
});

window.addEventListener("load", async () => {
  connectSocket();
  await registerServiceWorker();
  loadContent("home");
});
