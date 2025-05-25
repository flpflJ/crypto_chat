import { createContext, useContext, useEffect, useState } from "react";

const API_URL = process.env.REACT_APP_API_URL;
export const AppContext = createContext()

export const useAppContext = ()=>{
  return useContext(AppContext)
} 
export const AppProvider = ({children})=>{
  const [user, setUser] = useState({})
  const [loading, setLoading] = useState(false)
  const [isAuth, setIsAuth] = useState(false)
  const [userChats, setUserChats] = useState(null)// array of objects
  
  useEffect(()=>{
    const token = localStorage.getItem("token")
    if(token){ 
      setIsAuth(true)
      setUser({username: localStorage.getItem("username")})
      fetchUsers(token)
    }
  }, [])

  const [users, setUsers] = useState([]);

const fetchUsers = async (token) => {
  try {
    const res = await fetch("http://${API_URL}/api/users", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setUsers(data);
    }
  } catch (e) {
    console.error("Error fetching users:", e);
  }
};


const generateKeys = async () => {
  const keyPair = await window.crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"]
  );
  const pub = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
  const pubBase64 = btoa(String.fromCharCode(...new Uint8Array(pub)));

  const priv = await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const privBase64 = btoa(String.fromCharCode(...new Uint8Array(priv)));

  localStorage.setItem("privkey", privBase64);
  return pubBase64;
};

const onLogin = async (login, password) => {
  setLoading(true);
  try {
    const res = await fetch("http://${API_URL}/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: login, password })
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("username", data.username);
      setUser({ username: data.username });
      setIsAuth(true);
      await fetchUsers(data.access_token);

      const pubkey = await generateKeys();
      await fetch("http://${API_URL}/api/pubkey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${data.access_token}`
        },
        body: JSON.stringify({ username: data.username, pubkey })
      });
    } else {
      console.error(data.detail);
    }
  } finally {
    setLoading(false);
  }
};

const onRegister = async (name, login, password) => {
  setLoading(true);
  try {
    const res = await fetch("http://${API_URL}/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, login, password })
    });
    if (res.ok) {
      await onLogin(login, password);
    } else {
      const err = await res.json();
      console.error(err.detail);
    }
  } finally {
    setLoading(false);
  }
};

  const logout = ()=>{
    setLoading(true)
    localStorage.removeItem("token")
    localStorage.removeItem("user")
    setUser(null)
    setIsAuth(false)
    setLoading(false)
    setUsers([]);
  }

  return(
    <AppContext.Provider value={{
      isAuth, user, users, onLogin, logout, loading, onRegister
    }}>
      {children}
    </AppContext.Provider>
  )
}