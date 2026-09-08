import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import crypto from 'crypto'
import { phoneToUsername } from './phone.js'
import { setUsername, getUsernameForUser, searchUsernames } from './store.js'

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
    return res.status(400).json({ error: 'Телефон, имя и пароль обязательны' })
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
      body: JSON.stringify({ nonce, username, password, admin: false, mac, displayname: name }),
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

// Resolves the caller's Matrix user_id from their access token, rather than
// trusting a client-supplied user_id - otherwise anyone could set (or
// squat) another account's username.
async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' })
  try {
    const resp = await fetch(`${SYNAPSE_URL}/_matrix/client/v3/account/whoami`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) return res.status(401).json({ error: 'Недействительная сессия' })
    const { user_id: userId } = await resp.json()
    req.userId = userId
    next()
  } catch (err) {
    console.error('whoami check failed:', err.message)
    res.status(502).json({ error: 'Сервер регистрации недоступен' })
  }
}

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/

app.post('/username', requireAuth, (req, res) => {
  const username = String(req.body?.username || '').trim()
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Юзернейм: 5-32 символа, латиница/цифры/_, начинается с буквы' })
  }
  try {
    setUsername(req.userId, username)
    res.json({ ok: true, username })
  } catch (err) {
    if (err.code === 'USERNAME_TAKEN') return res.status(409).json({ error: err.message })
    console.error('setUsername failed:', err.message)
    res.status(500).json({ error: 'Не удалось сохранить юзернейм' })
  }
})

app.get('/username/me', requireAuth, (req, res) => {
  res.json({ username: getUsernameForUser(req.userId) })
})

app.get('/username/search', requireAuth, (req, res) => {
  const term = String(req.query.q || '').trim()
  if (!term) return res.json({ results: [] })
  res.json({ results: searchUsernames(term) })
})

app.get('/health', (req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Auth gateway listening on port ${PORT}`)
})
