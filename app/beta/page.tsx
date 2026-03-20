'use client'

import { useEffect, useState } from 'react'

type Mentor = 'sarah' | 'alex' | 'nick'

const GREETINGS: Record<Mentor, Record<string, string>> = {
  sarah: {
    es: 'Hola 🙂 Soy Sarah. Vamos a hacerlo simple: dime qué quieres trabajar y lo construimos paso a paso.',
    en: "Hi 🙂 I'm Sarah. Let's keep it simple: tell me what you want to work on and we'll build it step by step.",
    no: 'Hei 🙂 Jeg er Sarah. La oss gjøre det enkelt: fortell meg hva du vil jobbe med, så bygger vi det steg for steg.',
  },

  alex: {
    es: 'Hola, soy Alex. Vamos directo al punto: ¿qué objetivo concreto tienes hoy?',
    en: "Hi, I'm Alex. Let's go straight to the point: what's your goal today?",
    no: 'Hei, jeg er Alex. Rett på sak: hva er målet ditt i dag?',
  },

  nick: {
    es: '¡Hola! Soy Nick. Bien, ya tenemos el tema. ¿Qué situación concreta te gustaría practicar primero?',
    en: "Hi, I'm Nick. Good — topic is set. What specific situation would you like to practice first?",
    no: 'Hei! Jeg er Nick. Bra — tema er satt. Hvilken konkret situasjon vil du øve på først?',
    fr: 'Bonjour ! Je suis Nick. Bien — sujet défini. Quelle situation concrète souhaitez-vous pratiquer en premier?',
    de: 'Hallo! Ich bin Nick. Gut — Thema steht. Welche konkrete Situation möchtest du zuerst üben?',
    it: 'Ciao! Sono Nick. Bene — argomento definito. Quale situazione concreta vorresti esercitare prima?',
    pt: 'Olá! Sou Nick. Certo — tema definido. Que situação concreta você gostaria de praticar primeiro?',
    ar: 'مرحباً! أنا نيك. جيد — الموضوع محدد. ما الموقف المحدد الذي تريد التدرب عليه أولاً؟',
    ja: 'こんにちは！ニックです。テーマは決まりました。まず最初に、どんな具体的な場面を練習したいですか？',
    zh: '你好！我是Nick。好的，主题已经确定。你想先练习什么具体场景？',
  },
}

export default function Page() {
  const [messages, setMessages] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [mentor, setMentor] = useState<Mentor>('sarah')
  const [lang, setLang] = useState('es')

  // 🧠 INIT — greeting limpio
  useEffect(() => {
    const greeting =
      GREETINGS[mentor]?.[lang] ||
      GREETINGS[mentor]?.['en'] ||
      'Hello'

    setMessages([greeting])
  }, [])

  const sendMessage = async () => {
    if (!input.trim()) return

    const userMsg = input
    setMessages((prev) => [...prev, userMsg])
    setInput('')

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      })

      const data = await res.json()

      setMessages((prev) => [
        ...prev,
        data.message || '⚠️ error',
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        '⚠️ network error',
      ])
    }
  }

  return (
    <div style={{ padding: 20, maxWidth: 600, margin: '0 auto' }}>
      <h2>LINGORA</h2>

      <div
        style={{
          border: '1px solid #333',
          padding: 10,
          height: 400,
          overflowY: 'auto',
          marginBottom: 10,
        }}
      >
        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            {msg}
          </div>
        ))}
      </div>

      <input
        style={{ width: '80%', padding: 8 }}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Escribe aquí..."
      />

      <button
        onClick={sendMessage}
        style={{ padding: 8, marginLeft: 5 }}
      >
        Enviar
      </button>
    </div>
  )
}
