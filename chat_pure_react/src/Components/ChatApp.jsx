import React, { useContext, useState } from "react";
import { Layout, Form, Input, Button, List, Avatar, Typography, Tabs, Menu } from "antd";
import { UserOutlined, SendOutlined, LogoutOutlined } from "@ant-design/icons";
import { useAppContext } from "../Context/AppContext";
import { ChatContext } from "../Context/ChatContext";
import Sider from "antd/es/layout/Sider";

const { Header, Content, Footer } = Layout;
const { Title } = Typography;
const { TabPane } = Tabs;

export function ChatApp() {
  const {isAuth, user, onLogin, logout, loading, onRegister} = useAppContext()

  const { users, conversations, activeUser, setActiveUser, sendMessage } = useContext(ChatContext);
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (input.trim() && activeUser) {
      sendMessage(activeUser.username, input);
      setInput("");
    }
  };

  const getConversationKey = () => {
    if (!user || !activeUser) return null;
    return [user.username, activeUser.username].sort().join('-');
  };


  if (!isAuth) {
    return(
      <Layout style={{minHeight:"100vh", justifyContent:"center", alignItems:"center"}}>
        <Tabs defaultActiveKey="login" centered srtle={{width:300}}>
          <TabPane tab = "Вход" key = "login">

            <Form layout="vertical" autoComplete="off" onFinish={
              (e)=>{
                onLogin(e.username, e.password)
              }
            }>
                <Title level={3}>Вход</Title>

                <Form.Item
                  name="username"
                  rules = {[{required:true, message:"Введите имя пользователя"}]}
                >
                  <Input placeholder="Введите имя" prefix={<UserOutlined/>}/>
                </Form.Item>

                <Form.Item
                  
                  name="password"
                  rules={[{ required: true, message: 'Введите пароль' }]}
                >
                  <Input.Password placeholder="Пароль"  />
                </Form.Item>





                <Form.Item>
                  <Button type="primary" htmlType="submit">Войти</Button>
                </Form.Item>

            </Form>

          </TabPane>
          <TabPane tab = "Регистрация" key = "register" >
            <Form layout="vertical" autoComplete="off" onFinish={(e)=>{
              //name, login, password
              onRegister(e.name, e.login, e.password)
            }} > 
              <Title level={3}>Регистрация</Title>

              <Form.Item 
                name="login"
                rules={[{required:true, message:"Введите ваше имя"}]}
              >
                  <Input prefix = {<UserOutlined/>} name = "name" placeholder="Ваше имя" />

              </Form.Item>

              <Form.Item
                name="name"
                rules={[{required:true, message:"Введите логин"}]}

              >
                <Input placeholder="Логин"/>

              </Form.Item>

              <Form.Item
                  
                name="password"
                rules={[{ required: true, message: 'Введите пароль' }]}
              >
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
        <Header style={{ color: "white", fontSize: 18, display: "flex", justifyContent: "space-between" }}>
          Чат - {user.username}
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
                    title={msg.from}
                    description={msg.text}
                  />
                </List.Item>
              )}
            />
          ) : (
            <Title level={4}>Выберите пользователя для начала общения</Title>
          )}
        </Content>
        {activeUser && (
          <Footer>
            <Input.Group compact>
              <Input
                style={{ width: "calc(100% - 80px)" }}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onPressEnter={handleSend}
                placeholder={`Сообщение для ${activeUser.username}`}
              />
              <Button type="primary" icon={<SendOutlined />} onClick={handleSend}>Отправить</Button>
            </Input.Group>
          </Footer>
        )}
      </Layout>
    </Layout>
  );
}
