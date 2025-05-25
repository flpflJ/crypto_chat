import { useState } from 'react'
import { ChatApp } from './Components/ChatApp'
import { AppProvider } from './Context/AppContext'
import { ChatProvider } from './Context/ChatContext'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <AppProvider>
        <ChatProvider>
          <ChatApp/>
        </ChatProvider>
      </AppProvider>
    </>
  )
}

export default App
