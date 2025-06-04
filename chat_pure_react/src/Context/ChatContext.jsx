import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { AppContext } from './AppContext';

export const ChatContext = createContext();

export const ChatProvider = ({ children }) => {
  const { user, users } = useContext(AppContext);
  const [conversations, setConversations] = useState({});
  const [activeUser, setActiveUserState] = useState(null);
  const [socket, setSocket] = useState(null);
  const [publicKeys, setPublicKeys] = useState({});
  const publicKeysRef = useRef(publicKeys);
  const [retryCount, setRetryCount] = useState(0);
  const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

  // Обновление ref при изменении publicKeys
  useEffect(() => {
    publicKeysRef.current = publicKeys;
  }, [publicKeys]);

  // Вспомогательные функции
  const base64ToUint8 = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const uint8ToBase64 = (arr) => btoa(String.fromCharCode(...arr));
  const API_URL = import.meta.env.VITE_API_URL;

  // Загрузка публичных ключей
  useEffect(() => {
    const fetchPublicKeys = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await fetch(`http://${API_URL}/api/public_keys`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const keys = await res.json();
        setPublicKeys(keys);
      } catch (e) {
        console.error("Ошибка загрузки публичных ключей:", e);
      }
    };

    fetchPublicKeys();
  }, [API_URL]);

  // Подключение WebSocket с автоматическим переподключением
  useEffect(() => {
    if (!user?.username) return;

    let ws;
    let reconnectTimer;

    const connect = () => {
      ws = new WebSocket(`ws://${API_URL}/ws/${user.username}`);
      console.log("WebSocket: попытка подключения");

      ws.onopen = () => {
        console.log("WebSocket: подключение установлено");
        setSocket(ws);
        setRetryCount(0);
      };

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        const { from, text, timestamp, fileInfo } = data;
        const key = [from, user.username].sort().join('-');

        try {
          const privBase64 = localStorage.getItem("privkey");
          if (!privBase64) throw new Error("No private key in localStorage");

          // Импорт приватного ключа
          const privRaw = base64ToUint8(privBase64);
          const importedPriv = await crypto.subtle.importKey(
            "pkcs8", privRaw.buffer,
            { name: "RSA-OAEP", hash: "SHA-256" },
            false, ["decrypt"]
          );

          const encrypted = JSON.parse(text);
          if (!encrypted || !encrypted.aes_key || !encrypted.iv || !encrypted.cipher_text || !encrypted.signature) {
            throw new Error("Invalid encrypted payload");
          }

          // Расшифровка AES-ключа
          const aesKeyRaw = await crypto.subtle.decrypt(
            { name: "RSA-OAEP" },
            importedPriv,
            base64ToUint8(encrypted.aes_key)
          );

          // Импорт AES-ключа
          const aesKey = await crypto.subtle.importKey(
            "raw", aesKeyRaw,
            { name: "AES-GCM" },
            false, ["decrypt"]
          );

          // Расшифровка данных
          const decryptedData = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base64ToUint8(encrypted.iv) },
            aesKey,
            base64ToUint8(encrypted.cipher_text)
          );

          const decoder = new TextDecoder();
          const decrypted = JSON.parse(decoder.decode(decryptedData));
          
          // Проверка подписи
          const senderPubKey = publicKeysRef.current[from];
          if (!senderPubKey) throw new Error("Public key not found for sender");
          
          const pubKeyRaw = base64ToUint8(senderPubKey);
          const importedPubKey = await crypto.subtle.importKey(
            "spki", pubKeyRaw.buffer,
            { name: "RSA-PSS", hash: "SHA-256" },
            false, ["verify"]
          );

          const isValid = await crypto.subtle.verify(
            { name: "RSA-PSS", saltLength: 32 },
            importedPubKey,
            base64ToUint8(encrypted.signature),
            new TextEncoder().encode(JSON.stringify({
              content: decrypted.content,
              type: decrypted.type,
              ...(decrypted.fileName && { fileName: decrypted.fileName }),
              ...(decrypted.fileType && { fileType: decrypted.fileType })
            }))
          );

          const msg = {
            from,
            ...decrypted,
            verified: isValid, // Добавлено поле верификации
            timestamp: timestamp || Date.now(),
            ...(fileInfo && { fileInfo })
          };

          setConversations(prev => {
            const existing = prev[key] || [];
            return {
              ...prev,
              [key]: [...existing, msg]
            };
          });
        } catch (e) {
          console.error("Ошибка обработки сообщения:", e);
          
          // Добавляем сообщение об ошибке
          const errorMsg = {
            from,
            content: "Не удалось проверить подпись сообщения",
            type: 'error',
            verified: false,
            timestamp: Date.now()
          };
          
          setConversations(prev => ({
            ...prev,
            [key]: [...(prev[key] || []), errorMsg]
          }));
        }
      };

      ws.onerror = (e) => console.error("WebSocket error:", e);
      
      ws.onclose = (e) => {
        console.log(`WebSocket closed: ${e.code} ${e.reason}`);
        // Автоматическое переподключение с экспоненциальной задержкой
        const delay = Math.min(3000, 1000 * Math.pow(2, retryCount));
        console.log(`Повторное подключение через ${delay}ms`);
        reconnectTimer = setTimeout(() => {
          setRetryCount(prev => prev + 1);
          connect();
        }, delay);
      };
    };

    connect();

    return () => {
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [user?.username, API_URL, retryCount]); // Убрана зависимость от publicKeys

  const token = localStorage.getItem("token");

  // Загрузка истории переписки
  const loadConversation = useCallback(async (withUser) => {
    if (!withUser) return;

    try {
      const res = await fetch(`http://${API_URL}/api/messages/${withUser}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) throw new Error("Ошибка загрузки истории");
      const data = await res.json();
      const key = [user.username, withUser].sort().join('-');

      const privBase64 = localStorage.getItem("privkey");
      if (!privBase64) throw new Error("Private key not found");

      // Импорт приватного ключа
      const privRaw = base64ToUint8(privBase64);
      const importedPriv = await crypto.subtle.importKey(
        "pkcs8", privRaw.buffer,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false, ["decrypt"]
      );

      const decryptedMessages = [];

      for (const msg of data.messages || []) {
        try {
          let container;
          try {
            container = JSON.parse(msg.text);
          } catch {
            continue;
          }

          const encrypted = msg.from_user === user.username
            ? container.for_sender
            : container.for_recipient;

          if (!encrypted || !encrypted.aes_key || !encrypted.iv || !encrypted.cipher_text || !encrypted.signature) {
            continue;
          }

          // Расшифровка AES-ключа
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

          // Расшифровка данных
          const decryptedData = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: base64ToUint8(encrypted.iv) },
            aesKey,
            base64ToUint8(encrypted.cipher_text)
          );

          const decoder = new TextDecoder();
          const decrypted = JSON.parse(decoder.decode(decryptedData));

          // Проверка подписи
          const senderPubKey = publicKeys[msg.from_user];
          if (!senderPubKey) throw new Error("Public key not found");

          const pubKeyRaw = base64ToUint8(senderPubKey);
          const importedPubKey = await crypto.subtle.importKey(
            "spki", pubKeyRaw.buffer,
            { name: "RSA-PSS", hash: "SHA-256" },
            false, ["verify"]
          );

          const isValid = await crypto.subtle.verify(
            { name: "RSA-PSS", saltLength: 32 },
            importedPubKey,
            base64ToUint8(encrypted.signature),
            new TextEncoder().encode(JSON.stringify({
              content: decrypted.content,
              type: decrypted.type,
              ...(decrypted.fileName && { fileName: decrypted.fileName }),
              ...(decrypted.fileType && { fileType: decrypted.fileType })
            }))
          );
          
          decryptedMessages.push({
            from: msg.from_user,
            ...decrypted,
            verified: isValid, // Добавлено поле верификации
            timestamp: msg.timestamp || Date.now()
          });
        } catch (e) {
          console.error("Ошибка расшифровки сообщения:", e);
        }
      }

      setConversations(prev => ({ ...prev, [key]: decryptedMessages }));
    } catch (e) {
      console.error("Ошибка загрузки истории:", e);
    }
  }, [API_URL, user, token, publicKeys]);

  const setActiveUser = (userObj) => {
    setActiveUserState(userObj);
    if (userObj) loadConversation(userObj.username);
  };

  // Подпись контента
  const signContent = async (content, privateKey) => {
    const signature = await crypto.subtle.sign(
      { name: "RSA-PSS", saltLength: 32 },
      privateKey,
      new TextEncoder().encode(content)
    );
    return uint8ToBase64(new Uint8Array(signature));
  };

  // Отправка сообщения (с опцией повреждения подписи для демо)
  const sendMessage = async (to, content, type = 'text', fileName = null, fileType = null, corruptSignature = false) => {
    const key = [user.username, to].sort().join('-');

    try {
      // Получение публичных ключей
      const res = await fetch(`http://${API_URL}/api/public_keys`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const pubkeys = await res.json();
      setPublicKeys(pubkeys);

      const pubkeyToRaw = base64ToUint8(pubkeys[to]);
      const pubkeySelfRaw = base64ToUint8(pubkeys[user.username]);

      // Импорт публичных ключей
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

      // Импорт приватного ключа для подписи
      const privBase64 = localStorage.getItem("privkey");
      if (!privBase64) throw new Error("Private key not found");
      const privRaw = base64ToUint8(privBase64);
      const importedPriv = await crypto.subtle.importKey(
        "pkcs8", privRaw.buffer,
        { name: "RSA-PSS", hash: "SHA-256" },
        false, ["sign"]
      );

      // Подготовка данных
      const payload = {
        content,
        type,
        ...(fileName && { fileName }),
        ...(fileType && { fileType })
      };

      // Подпись данных
      let signature = await signContent(JSON.stringify(payload), importedPriv);

      // Демо-режим: повреждение подписи
      if (isDemoMode && corruptSignature) {
        console.log("ДЕМО: Повреждение подписи");
        console.log('Оригинальная подпись:', signature);
        const sigBytes = base64ToUint8(signature);
        sigBytes[0] ^= 0xFF; // Инвертируем первый байт
        signature = uint8ToBase64(sigBytes);
        console.log('Поврежденная подпись:', signature);
      }

      // Шифрование данных
      const encoder = new TextEncoder();
      const dataToEncrypt = encoder.encode(JSON.stringify(payload));

      // Генерация AES-ключа
      const aesKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true, ["encrypt", "decrypt"]
      );
      const aesRaw = await crypto.subtle.exportKey("raw", aesKey);

      // Шифрование данных
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipherText = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        aesKey,
        dataToEncrypt
      );

      // Шифрование AES-ключа
      const encryptedAesKeyTo = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" }, importedPubKeyTo, aesRaw
      );
      const encryptedAesKeySelf = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" }, importedPubKeySelf, aesRaw
      );

      // Формирование контейнеров
      const buildEncryptedPayload = (encryptedAesKey) => ({
        aes_key: uint8ToBase64(new Uint8Array(encryptedAesKey)),
        iv: uint8ToBase64(iv),
        cipher_text: uint8ToBase64(new Uint8Array(cipherText)),
        signature
      });

      const fullPayload = {
        for_sender: buildEncryptedPayload(encryptedAesKeySelf),
        for_recipient: buildEncryptedPayload(encryptedAesKeyTo)
      };

      // Отправка через WebSocket
      socket?.send(JSON.stringify({ 
        to, 
        text: JSON.stringify(fullPayload.for_recipient),
        ...(type === 'file' && { 
          fileInfo: { fileName, fileType, fileSize: content.length } 
        })
      }));

      // Сохранение на сервере
      await fetch(`http://${API_URL}/api/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          from_user: user.username,
          to_user: to,
          text: JSON.stringify(fullPayload)
        })
      });

      // Добавление в локальное состояние
      const newMsg = {
        from: user.username,
        content,
        type,
        verified: true,
        ...(fileName && { fileName }),
        ...(fileType && { fileType }),
        timestamp: Date.now()
      };

      setConversations(prev => ({
        ...prev,
        [key]: [...(prev[key] || []), newMsg]
      }));
    } catch (e) {
      console.error("Ошибка отправки:", e);
    }
  };

  // Отправка файла (с опцией повреждения подписи)
  const sendFile = async (to, file, corruptSignature = false) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async () => {
        try {
          const base64Data = reader.result.split(',')[1];
          await sendMessage(
            to, 
            base64Data, 
            'file', 
            file.name, 
            file.type,
            corruptSignature // Передаем флаг повреждения подписи
          );
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  };

  // Скачивание файла
  const downloadFile = (message) => {
    if (message.type !== 'file') return;
    
    const byteCharacters = atob(message.content);
    const byteNumbers = new Array(byteCharacters.length);
    
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: message.fileType });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = message.fileName || 'file';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <ChatContext.Provider value={{
      users,
      conversations,
      activeUser,
      setActiveUser,
      sendMessage,
      sendFile,
      downloadFile,
      isDemoMode // Передаем флаг демо-режима
    }}>
      {children}
    </ChatContext.Provider>
  );
};