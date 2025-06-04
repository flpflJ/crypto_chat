from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from jose import jwt, JWTError
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import uvicorn
import uuid

# Simple in-memory storage
USERS_DB = {}  # username -> {password, name, pubkey}
PUBLIC_KEYS = {}  # username -> pubkey
MESSAGES = {}  # conv_key -> [msg_dicts]

SECRET_KEY = "secret"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

app = FastAPI()

origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/token")

class UserRegister(BaseModel):
    name: str
    login: str
    password: str

class PublicKeyIn(BaseModel):
    username: str
    pubkey: str

class MessageIn(BaseModel):
    from_user: str
    to_user: str
    text: str  # encrypted text (JSON-encoded hybrid)
    file_info: Optional[dict] = None  # Добавляем поле для метаданных файла

class MessageOut(BaseModel):
    from_user: str
    text: str
    timestamp: str
    file_info: Optional[dict] = None  # Добавляем поле для метаданных файла

# Auth utils
def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return username
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# API endpoints
@app.post("/api/register")
def register(user: UserRegister):
    if user.login in USERS_DB:
        raise HTTPException(status_code=400, detail="User already exists")
    USERS_DB[user.login] = {"password": user.password, "name": user.name, "pubkey": None}
    return {"msg": "ok"}

@app.post("/api/token")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = USERS_DB.get(form_data.username)
    if not user or user["password"] != form_data.password:
        raise HTTPException(status_code=400, detail="Invalid credentials")
    access_token = create_access_token(data={"sub": form_data.username},
                                       expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    return {"access_token": access_token, "token_type": "bearer", "username": form_data.username}

@app.post("/api/pubkey")
def save_pubkey(data: PublicKeyIn, username: str = Depends(get_current_user)):
    if username != data.username:
        raise HTTPException(status_code=403, detail="Token/user mismatch")
    USERS_DB[username]["pubkey"] = data.pubkey
    PUBLIC_KEYS[username] = data.pubkey
    return {"msg": "pubkey saved"}

@app.get("/api/public_keys")
def get_public_keys(username: str = Depends(get_current_user)):
    return PUBLIC_KEYS

@app.get("/api/users")
def get_users(username: str = Depends(get_current_user)):
    return [
        {"username": u, "name": USERS_DB[u]["name"]}
        for u in USERS_DB
        if u != username and USERS_DB[u].get("pubkey")
    ]

@app.get("/api/messages/{with_user}")
def get_conversation(with_user: str, username: str = Depends(get_current_user)):
    key = "-".join(sorted([username, with_user]))
    raw = MESSAGES.get(key, [])
    return {"messages": [
        {
            "from_user": msg["from"],
            "to_user": with_user if msg["from"] != with_user else username,
            "text": msg["text"],
            "timestamp": msg["timestamp"]
        }
        for msg in raw
    ]}


@app.post("/api/messages")
def save_message(msg: MessageIn, username: str = Depends(get_current_user)):
    if msg.from_user != username:
        raise HTTPException(status_code=403, detail="Sender mismatch")
    key = "-".join(sorted([msg.from_user, msg.to_user]))
    print(f"[SAVE] {key}: {msg.text}")
    MESSAGES.setdefault(key, []).append({
        "from": msg.from_user,
        "text": msg.text,
        "timestamp": datetime.utcnow().isoformat()
    })
    return {"msg": "stored"}

# WebSocket
active_connections: Dict[str, WebSocket] = {}

@app.websocket("/ws/{username}")
async def websocket_endpoint(websocket: WebSocket, username: str):
    await websocket.accept()
    active_connections[username] = websocket
    try:
        while True:
            # Увеличиваем максимальный размер сообщения
            data = await websocket.receive_json()
            target = data["to"]
            timestamp = datetime.utcnow().isoformat()
            msg = {
                "from": username,
                "text": data["text"],
                "timestamp": timestamp,
                "file_info": data.get("file_info")  # Сохраняем метаданные файла
            }
            if target in active_connections:
                await active_connections[target].send_json(msg)
            key = "-".join(sorted([username, target]))
            MESSAGES.setdefault(key, []).append(msg)
    except WebSocketDisconnect:
        del active_connections[username]