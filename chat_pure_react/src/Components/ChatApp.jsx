import React, { useContext, useState, useRef } from "react";
import { 
  Layout, 
  Form, 
  Input, 
  Button, 
  List, 
  Avatar, 
  Typography, 
  Tabs, 
  Menu, 
  Checkbox, 
  Tooltip,
  Popover
} from "antd";
import { 
  UserOutlined, 
  SendOutlined, 
  LogoutOutlined, 
  PaperClipOutlined,
  DownloadOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined
} from "@ant-design/icons";
import { useAppContext } from "../Context/AppContext";
import { ChatContext } from "../Context/ChatContext";
import Sider from "antd/es/layout/Sider";

const { Header, Content, Footer } = Layout;
const { Title, Text } = Typography;
const { TabPane } = Tabs;

export function ChatApp() {
  const {isAuth, user, onLogin, logout, loading, onRegister} = useAppContext()
  const { 
    users, 
    conversations, 
    activeUser, 
    setActiveUser, 
    sendMessage, 
    sendFile,
    downloadFile,
    isDemoMode
  } = useContext(ChatContext);
  
  const [input, setInput] = useState("");
  const [corruptSignature, setCorruptSignature] = useState(false);
  const fileInputRef = useRef(null);

  const handleSend = () => {
    if (input.trim() && activeUser) {
      sendMessage(activeUser.username, input, 'text', null, null, corruptSignature);
      setInput("");
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file && activeUser) {
      sendFile(activeUser.username, file, corruptSignature);
      e.target.value = null; // Сброс input для выбора того же файла
    }
  };

  const getConversationKey = () => {
    if (!user || !activeUser) return null;
    return [user.username, activeUser.username].sort().join('-');
  };

  // Функция для отображения статуса подписи
  const renderSignatureStatus = (msg) => {
    if (msg.verified === undefined) {
      return null; // Для старых сообщений без статуса
    }
    
    return msg.verified ? (
      <Tooltip title="Подпись проверена">
        <CheckCircleOutlined style={{ color: 'green', marginLeft: 8 }} />
      </Tooltip>
    ) : (
      <Tooltip title="Подпись недействительна!">
        <ExclamationCircleOutlined style={{ color: 'red', marginLeft: 8 }} />
      </Tooltip>
    );
  };

  if (!isAuth) {
    return(
      <Layout style={{minHeight:"100vh", justifyContent:"center", alignItems:"center"}}>
        <Tabs defaultActiveKey="login" centered style={{width:300}}>
          <TabPane tab = "Вход" key = "login">
            <Form layout="vertical" autoComplete="off" onFinish={(e) => onLogin(e.username, e.password)}>
                <Title level={3}>Вход</Title>
                <Form.Item name="username" rules={[{required:true, message:"Введите имя пользователя"}]}>
                  <Input placeholder="Введите имя" prefix={<UserOutlined/>}/>
                </Form.Item>
                <Form.Item name="password" rules={[{ required: true, message: 'Введите пароль' }]}>
                  <Input.Password placeholder="Пароль"  />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit">Войти</Button>
                </Form.Item>
            </Form>
          </TabPane>
          <TabPane tab = "Регистрация" key = "register" >
            <Form layout="vertical" autoComplete="off" onFinish={(e) => onRegister(e.name, e.login, e.password)} > 
              <Title level={3}>Регистрация</Title>
              <Form.Item name="login" rules={[{required:true, message:"Введите ваше имя"}]}>
                  <Input prefix = {<UserOutlined/>} name = "name" placeholder="Ваше имя" />
              </Form.Item>
              <Form.Item name="name" rules={[{required:true, message:"Введите логин"}]}>
                <Input placeholder="Логин"/>
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: 'Введите пароль' }]}>
                <Input.Password placeholder="Пароль"  />
              </Form.Item>
              <Form.Item>
                <Button htmlType="submit" block type="primary"> Зарегестрироваться</Button>
              </Form.Item>
            </Form>
          </TabPane>
        </Tabs>
      </Layout>
    )
  }

  const conversationKey = getConversationKey();
  const currentMessages = conversationKey ? conversations[conversationKey] || [] : [];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={200} className="site-layout-background">
        <Menu
          mode="inline"
          selectedKeys={[activeUser?.username]}
          onClick={({ key }) => setActiveUser(users.find(u => u.username === key))}
          style={{ height: '100%', borderRight: 0 }}
        >
          {users.map((u) => (
            <Menu.Item key={u.username} icon={<UserOutlined />}>{u.username}</Menu.Item>
          ))}
        </Menu>
      </Sider>
      <Layout>
        <Header style={{ 
          color: "white", 
          fontSize: 18, 
          display: "flex", 
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div>
            Чат - {user.username}
            {isDemoMode && (
              <Popover 
                content="Демо-режим позволяет имитировать повреждение электронной подписи" 
                title="Режим демонстрации"
              >
                <InfoCircleOutlined style={{ color: 'gold', marginLeft: 10 }} />
              </Popover>
            )}
          </div>
          <Button icon={<LogoutOutlined />} onClick={logout}>Выйти</Button>
        </Header>
        <Content style={{ padding: "1rem" }}>
          {activeUser ? (
            <List
              dataSource={currentMessages}
              renderItem={(msg, index) => (
                <List.Item key={index}>
                  <List.Item.Meta
                    avatar={<Avatar icon={<UserOutlined />} />}
                    title={
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span>{msg.from}</span>
                        {renderSignatureStatus(msg)}
                      </div>
                    }
                    description={
                      msg.type === 'file' ? (
                        <div>
                          <Text strong>{msg.fileName}</Text>
                          <br />
                          <Button 
                            type="link" 
                            icon={<DownloadOutlined />}
                            onClick={() => downloadFile(msg)}
                          >
                            Скачать файл
                          </Button>
                        </div>
                      ) : msg.type === 'error' ? (
                        <Text type="danger">{msg.content}</Text>
                      ) : (
                        msg.content
                      )
                    }
                  />
                </List.Item>
              )}
            />
          ) : (
            <Title level={4}>Выберите пользователя для начала общения</Title>
          )}
        </Content>
        {activeUser && (
          <Footer style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleFileSelect}
              style={{ display: 'none' }} 
            />
            <Button 
              icon={<PaperClipOutlined />} 
              onClick={() => fileInputRef.current.click()}
            />
            <Input
              style={{ flex: 1 }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={handleSend}
              placeholder={`Сообщение для ${activeUser.username}`}
            />
            
            {isDemoMode && (
              <Checkbox
                checked={corruptSignature}
                onChange={(e) => setCorruptSignature(e.target.checked)}
                style={{ marginRight: 8 }}
              >
                Повредить подпись
              </Checkbox>
            )}
            
            <Button 
              type="primary" 
              icon={<SendOutlined />} 
              onClick={handleSend}
            >
              Отправить
            </Button>
          </Footer>
        )}
      </Layout>
    </Layout>
  );
}