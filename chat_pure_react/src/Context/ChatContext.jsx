import React, { createContext, useState, useContext, useEffect } from 'react';
import { AppContext } from './AppContext';
export const ChatContext = createContext();

export const ChatProvider = ({ children }) => {
  const { user, users } = useContext(AppContext);

  const [conversations, setConversations] = useState({});
  const [activeUser, setActiveUserState] = useState(null);
  const [socket, setSocket] = useState(null);

  // Вспомогательные функции для конвертации Base64 <-> Uint8Array
  const base64ToUint8 = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const uint8ToBase64 = (arr) => btoa(String.fromCharCode(...arr));
  const API_URL = import.meta.env.VITE_API_URL;
  useEffect(() => {
    if (!user?.username) return;

    const ws = new WebSocket(`ws://${API_URL}/ws/${user.username}`);
    setSocket(ws);

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      const { from, text, timestamp } = data;
      const key = [from, user.username].sort().join('-');

      try {
        const privBase64 = localStorage.getItem("privkey");
        if (!privBase64) throw new Error("No private key in localStorage");

        // Импорт приватного RSA-ключа пользователя
        const privRaw = base64ToUint8(privBase64);
        const importedPriv = await crypto.subtle.importKey(
          "pkcs8", privRaw.buffer,
          { name: "RSA-OAEP", hash: "SHA-256" },
          false, ["decrypt"]
        );

        const encrypted = JSON.parse(text);
        if (!encrypted || !encrypted.aes_key || !encrypted.iv || !encrypted.cipher_text) {
          throw new Error("Invalid encrypted payload from WebSocket");
        }

        // Расшифровка AES-ключа с помощью приватного RSA-ключа
        const aesKeyRaw = await crypto.subtle.decrypt(
          { name: "RSA-OAEP" },
          importedPriv,
          base64ToUint8(encrypted.aes_key)
        );

        // Импорт расшифрованного AES-ключа
        const aesKey = await crypto.subtle.importKey(
          "raw", aesKeyRaw,
          { name: "AES-GCM" },
          false, ["decrypt"]
        );

        // Расшифровка текста сообщения с помощью AES-ключа
        const decryptedText = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: base64ToUint8(encrypted.iv) },
          aesKey,
          base64ToUint8(encrypted.cipher_text)
        );

        const decoder = new TextDecoder();
        const plain = decoder.decode(decryptedText);

        const msg = { from, text: plain, timestamp: timestamp || Date.now() };

        setConversations(prev => {
          const existing = prev[key] || [];
          const isDuplicate = existing.some(m => m.text === msg.text && m.timestamp === msg.timestamp && m.from === msg.from);
          return isDuplicate ? prev : {
            ...prev,
            [key]: [...existing, msg]
          };
        });
      } catch (e) {
        console.error("Ошибка расшифровки сообщения (WebSocket):", e);
      }
    };

    ws.onerror = (e) => console.error("WebSocket error:", e);
    ws.onclose = () => console.log("WebSocket closed");

    return () => ws.close();
  }, [user?.username]);

  const token = localStorage.getItem("token");

  const loadConversation = async (withUser) => {
    if (!withUser) return;

    try {
      const res = await fetch(`http://${API_URL}/api/messages/${withUser}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) throw new Error("Ошибка загрузки истории сообщений");
      const data = await res.json();
      const key = [user.username, withUser].sort().join('-');

      const privBase64 = localStorage.getItem("privkey");
      if (!privBase64) throw new Error("Приватный ключ не найден в localStorage");

      // Импорт приватного RSA-ключа
      const privRaw = base64ToUint8(privBase64);
      const importedPriv = await crypto.subtle.importKey(
        "pkcs8", privRaw.buffer,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false, ["decrypt"]
      );

      const decoder = new TextDecoder();
      const decryptedMessages = [];

      for (const msg of data.messages || []) {
        try {
          let container;
          try {
            container = JSON.parse(msg.text);
          } catch {
            continue;
          }

          // Получаем нужный контейнер: for_sender или for_recipient
          const encrypted = msg.from_user === user.username
            ? container.for_sender
            : container.for_recipient;

          if (
            typeof encrypted !== "object" ||
            !encrypted.aes_key ||
            !encrypted.iv ||
            !encrypted.cipher_text
          ) {
            continue;
          }

          // Расшифровка AES-ключа и текста
          const aesKeyRaw = await crypto.subtle.decrypt(
            { name: "RSA-OAEP" },
            importedPriv,
            base64ToUint8(encrypted.aes_key)
          );

          const aesKey = await crypto.subtle.importKey(
            "raw", aesKeyRaw,
            { name: "AES-GCM" },
            false, ["decrypt"]
          );

          const decryptedText = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base64ToUint8(encrypted.iv) },
            aesKey,
            base64ToUint8(encrypted.cipher_text)
          );

          decryptedMessages.push({
            from: msg.from_user,
            text: decoder.decode(decryptedText),
            timestamp: msg.timestamp || Date.now()
          });
        } catch (e) {
          console.error("Ошибка расшифровки сообщения (history):", e.message);
        }
      }

      setConversations(prev => ({ ...prev, [key]: decryptedMessages }));
    } catch (e) {
      console.error("Ошибка загрузки истории переписки:", e);
    }
  };

  const setActiveUser = (userObj) => {
    setActiveUserState(userObj);
    if (userObj) loadConversation(userObj.username);
  };

  const sendMessage = async (to, message) => {
    const key = [user.username, to].sort().join('-');

    try {
      const res = await fetch(`http://${API_URL}/api/public_keys`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const pubkeys = await res.json();

      const pubkeyToRaw = base64ToUint8(pubkeys[to]);
      const pubkeySelfRaw = base64ToUint8(pubkeys[user.username]);

      // Импорт публичных RSA-ключей получателя и отправителя
      const importedPubKeyTo = await crypto.subtle.importKey(
        "spki", pubkeyToRaw.buffer,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false, ["encrypt"]
      );
      const importedPubKeySelf = await crypto.subtle.importKey(
        "spki", pubkeySelfRaw.buffer,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false, ["encrypt"]
      );

      // Генерация одноразового AES-ключа
      const aesKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true, ["encrypt", "decrypt"]
      );
      const aesRaw = await crypto.subtle.exportKey("raw", aesKey);

      // Генерация IV и шифрование сообщения AES-GCM
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipherText = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        aesKey,
        new TextEncoder().encode(message)
      );

      // Шифрование AES-ключа RSA-ключами получателя и отправителя
      const encryptedAesKeyTo = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" }, importedPubKeyTo, aesRaw
      );
      const encryptedAesKeySelf = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" }, importedPubKeySelf, aesRaw
      );

      // Сборка контейнеров
      const buildEncryptedPayload = (encryptedAesKey) => ({
        aes_key: uint8ToBase64(new Uint8Array(encryptedAesKey)),
        iv: uint8ToBase64(iv),
        cipher_text: uint8ToBase64(new Uint8Array(cipherText))
      });

      const payload = {
        for_sender: buildEncryptedPayload(encryptedAesKeySelf),
        for_recipient: buildEncryptedPayload(encryptedAesKeyTo)
      };

      // Отправка получателю по WebSocket
      socket?.send(JSON.stringify({ to, text: JSON.stringify(payload.for_recipient) }));

      // Сохранение сообщения на сервере (оба контейнера)
      await fetch(`http://${API_URL}/api/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          from_user: user.username,
          to_user: to,
          text: JSON.stringify(payload)
        })
      });

      const newMsg = { from: user.username, to, text: message, timestamp: Date.now() };

      setConversations(prev => {
        const existing = prev[key] || [];
        const isDuplicate = existing.some(m => m.text === newMsg.text && m.timestamp === newMsg.timestamp && m.from === newMsg.from);
        return isDuplicate ? prev : {
          ...prev,
          [key]: [...existing, newMsg]
        };
      });
    } catch (e) {
      console.error("Ошибка sendMessage:", e);
    }
  };

  return (
    <ChatContext.Provider value={{
      users,
      conversations,
      activeUser,
      setActiveUser,
      sendMessage
    }}>
      {children}
    </ChatContext.Provider>
  );
};
