import dotenv from 'dotenv'
dotenv.config()

import TelegramBot from 'node-telegram-bot-api'
import axios from 'axios'
import moment from 'moment'
import fs from 'fs'
import path from 'path'
import cron from 'node-cron'
import XLSX from 'xlsx'

// Konfiguratsiya
const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error("Telegram Bot Token kiritilmagan!")
  process.exit(1)
}

const backendUrl = "https://backend.imanakhmedovna.uz"
const CHAT_IDS_FILE = path.join(process.cwd(), 'chat_ids.json')

// Saytlar ro'yxati
const websites = [
  { name: "Sayt", url: "https://imanakhmedovna.uz"},
]

// Botni ishga tushirish
const bot = new TelegramBot(token, { polling: true })

// Barcha chat ID'larni saqlash uchun
const allChatIds = new Set()

function initChatIdsFile() {
  try {
    if (!fs.existsSync(CHAT_IDS_FILE)) {
      fs.writeFileSync(CHAT_IDS_FILE, JSON.stringify([]))
      console.log('chat_ids.json fayli yaratildi')
    }
    
    const data = JSON.parse(fs.readFileSync(CHAT_IDS_FILE, 'utf8'))
    data.forEach(id => allChatIds.add(id))
    console.log(`${data.length} ta chat ID yuklandi`)
  } catch (err) {
    console.error('Chat ID fayli bilan ishlashda xato:', err)
  }
}

function saveChatIds() {
  try {
    const ids = Array.from(allChatIds)
    fs.writeFileSync(CHAT_IDS_FILE, JSON.stringify(ids, null, 2))
    console.log(`${ids.length} ta chat ID saqlandi`)
  } catch (err) {
    console.error('Chat ID saqlashda xato:', err)
  }
}

// === Sayt holatini tekshirish ===
async function checkWebsites() {
  const results = []
  
  for (const site of websites) {
    try {
      const startTime = Date.now()
      const res = await axios.get(site.url, { timeout: 10000 })
      const responseTime = Date.now() - startTime
      
      results.push({
        name: site.name,
        status: res.status === 200 ? '✅ Ishlamoqda' : '⚠️ Xatolik',
        responseTime: `${responseTime}ms`,
        url: site.url
      })
    } catch (err) {
      results.push({
        name: site.name,
        status: '❌ Ishlamayabdi',
        responseTime: 'N/A',
        url: site.url,
        error: err.message
      })
    }
  }
  
  return results
}

// === Text fayl yaratish ===
async function createTextFile() {
  const response = await axios.get(`${backendUrl}/user`)
  const users = response.data

  const textFileName = `users_${moment().format('DDMMYYYY_HHmmss')}.txt`
  const tempFilePath = path.join(process.cwd(), textFileName)

  let fileContent = `📋 Foydalanuvchilar ro'yxati (${moment().format('DD.MM.YYYY HH:mm:ss')})\n`
  fileContent += `Jami foydalanuvchilar: ${users.length}\n\n`

  fileContent += `|  №  |      ID      |       Ism       |    Tel raqam    |     TG username     |\n`
  fileContent += `|-----|--------------|-----------------|------------------|----------------------|\n`

  users.forEach((user, index) => {
    const id = user.id || 'N/A'
    const name = user.full_name || 'N/A'
    const phone = user.phone_number || 'N/A'
    const tg_user = user.tg_user || 'N/A'
    fileContent += `| ${String(index + 1).padEnd(3)} | ${String(id).padEnd(12)} | ${name.padEnd(15)} | ${phone.padEnd(16)} | ${tg_user.padEnd(20)} |\n`
  })

  fs.writeFileSync(tempFilePath, fileContent, 'utf8')

  return {
    path: tempFilePath,
    usersCount: users.length
  }
}

// === Kunlik lidlar uchun text + excel yaratish ===
async function createDailyLeadsFiles() {
  const response = await axios.get(`${backendUrl}/user`)
  const users = response.data

  // Bugungi sana
  const today = moment().format("YYYY-MM-DD")
  const todayUsers = users.filter(u => moment(u.createdAt).format("YYYY-MM-DD") === today)

  // 1. TEXT fayl
  const textPath = path.join(process.cwd(), `daily_leads_${moment().format('DDMMYYYY')}.txt`)
  let content = `📅 Bugungi (${moment().format('DD.MM.YYYY')}) ro'yxatdan o‘tgan foydalanuvchilar\n`
  content += `Jami: ${todayUsers.length} ta\n\n`

  todayUsers.forEach((u, i) => {
    content += `${i + 1}. ${u.full_name || 'N/A'} | ${u.phone_number || 'N/A'} | ${u.tg_user || 'N/A'}\n`
  })
  fs.writeFileSync(textPath, content, 'utf8')

  // 2. EXCEL fayl
  const excelPath = path.join(process.cwd(), `daily_leads_${moment().format('DDMMYYYY')}.xlsx`)
  const sheetData = todayUsers.map((u, i) => ({
  "№": i + 1,
  "Ism": u.full_name || 'N/A',
  "Telefon raqam": u.phone_number || 'N/A',
  "TG username": u.tg_user || 'N/A',
  "Ro‘yxatdan o‘tgan sana": moment(u.createdAt).format('DD.MM.YYYY HH:mm')
}))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(sheetData)
  XLSX.utils.book_append_sheet(wb, ws, "Daily Leads")
  XLSX.writeFile(wb, excelPath)

  return { textPath, excelPath, count: todayUsers.length }
}

// === /statistika komanda ===
// === /statistika komanda ===
bot.onText(/\/statistika/, async (msg) => {
  const chatId = msg.chat.id

  try {
    const loadingMsg = await bot.sendMessage(chatId, "📊 Statistika tayyorlanmoqda...")

    // Foydalanuvchilarni olish
    const response = await axios.get(`${backendUrl}/user`)
    const users = response.data

    // Sanalar bo‘yicha guruhlash
    const stats = {}
    users.forEach(user => {
      const date = moment(user.createdAt).format("DD.MM.YYYY")
      stats[date] = (stats[date] || 0) + 1
    })

    // Sana bo‘yicha sortlash
    const sortedStats = Object.keys(stats).sort(
      (a, b) => moment(a, "DD.MM.YYYY") - moment(b, "DD.MM.YYYY")
    )

    // Matnli statistika
    let statText = `📅 *Ro‘yxatdan o‘tganlar statistikasi*\n\n`
    sortedStats.forEach(date => {
      statText += `🔹 ${date}: ${stats[date]} ta odam\n`
    })

    // 📊 EXCEL fayl yaratish (kunlar bo‘yicha)
    const excelData = sortedStats.map((date, i) => ({
      "№": i + 1,
      "Sana": date,
      "Ro‘yxatdan o‘tganlar soni": stats[date],
    }))

    const excelPathStats = path.join(process.cwd(), `daily_stats_${moment().format("DDMMYYYY_HHmmss")}.xlsx`)
    const wbStats = XLSX.utils.book_new()
    const wsStats = XLSX.utils.json_to_sheet(excelData)
    XLSX.utils.book_append_sheet(wbStats, wsStats, "Statistika")
    XLSX.writeFile(wbStats, excelPathStats)

    // Bugungi lidlar uchun fayllar
    const { textPath, excelPath, count } = await createDailyLeadsFiles()

    // Loading xabarini o‘chirish
    await bot.deleteMessage(chatId, loadingMsg.message_id)

    // Statistika matnini yuborish
    await bot.sendMessage(chatId, `${statText}\n\n📆 Bugungi lidlar: ${count} ta`, { parse_mode: "Markdown" })

    // Fayllarni yuborish
    await bot.sendDocument(chatId, fs.createReadStream(excelPathStats))
    await bot.sendDocument(chatId, fs.createReadStream(textPath))
    await bot.sendDocument(chatId, fs.createReadStream(excelPath))

    // Fayllarni o‘chirish
    fs.unlink(excelPathStats, () => {})
    fs.unlink(textPath, () => {})
    fs.unlink(excelPath, () => {})

  } catch (error) {
    console.error("❌ Statistika olishda xato:", error)
    bot.sendMessage(chatId, "⚠️ Statistika olishda xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko‘ring.")
  }
})


// Dastlabki sozlamalar
initChatIdsFile()

console.log("✅ Bot muvaffaqiyatli ishga tushdi!")
