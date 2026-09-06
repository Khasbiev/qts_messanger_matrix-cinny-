import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import crypto from 'crypto'
import { phoneToUsername } from './phone.js'

const { REGISTRATION_SHARED_SECRET, SYNAPSE_URL, PORT = 4001 } = process.env

if (!REGISTRATION_SHARED_SECRET || !SYNAPSE_URL) {
  console.error('REGISTRATION_SHARED_SECRET and SYNAPSE_URL must be set')
  process.exit(1)
}

const app = express()
app.use(cors())
app.use(express.json())

app.post('/register', async (req, res) => {
  const { phone, name, password } = req.body || {}
  if (!phone || !name || !password) {
    return res.status(400).json({ error: 'phone, name and password required' })
  }
  const username = phoneToUsername(phone)
  if (!username) {
    return res.status(400).json({ error: 'Некорректный номер телефона' })
  }

  try {
    const nonceResp = await fetch(`${SYNAPSE_URL}/_synapse/admin/v1/register`)
    const { nonce } = await nonceResp.json()

    const mac = crypto
      .createHmac('sha1', REGISTRATION_SHARED_SECRET)
      .update(`${nonce}\0${username}\0${password}\0notadmin`)
      .digest('hex')

    const regResp = await fetch(`${SYNAPSE_URL}/_synapse/admin/v1/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce, username, password, admin: false, mac }),
    })
    const regData = await regResp.json()

    if (!regResp.ok) {
      if (regData.errcode === 'M_USER_IN_USE') {
        return res.status(409).json({ error: 'Этот номер уже зарегистрирован' })
      }
      return res.status(502).json({ error: 'Не удалось создать аккаунт' })
    }

    res.json({ ok: true, username })
  } catch (err) {
    console.error('Registration failed:', err.message)
    res.status(502).json({ error: 'Сервер регистрации недоступен' })
  }
})

app.get('/health', (req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Auth gateway listening on port ${PORT}`)
})
