import dotenv from 'dotenv'
dotenv.config()

import TelegramBot from 'node-telegram-bot-api'
import axios from 'axios'
import moment from 'moment'
import fs from 'fs'
import path from 'path'
import cron from 'node-cron'
import xlsx from 'xlsx'

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
  { name: "Dangasalik", url: "https://dangasalikni-yengish.imanakhmedovna.uz" },
  { name: "Maqsadlarga erishish", url: "https://maqsadlarga-erishish.imanakhmedovna.uz" },
  { name: "Intizom", url: "https://intizomni.shakillantirish.imanakhmedovna.uz" }
]

// Botni ishga tushirish
const bot = new TelegramBot(token, { polling: true })

// Barcha chat ID'larni saqlash uchun
const allChatIds = new Set()

// JSON faylni avtomatik yaratish va yuklash
function initChatIdsFile() {
  try {
    if (!fs.existsSync(CHAT_IDS_FILE)) {
      fs.writeFileSync(CHAT_IDS_FILE, JSON.stringify([]))
      console.log('chat_ids.json fayli yaratildi')
    }
    
    const data = JSON.parse(fs.readFileSync(CHAT_IDS_FILE, 'utf8'))
    data.forEach(id => allChatIds.add(id))
    console.log(`${data.length} ta chat ID yuklandi (guruhlar, kanallar, shaxsiy chatlar)`)
    
  } catch (err) {
    console.error('Chat ID fayli bilan ishlashda xato:', err)
  }
}

// Chat ID'larni JSON faylga saqlash
function saveChatIds() {
  try {
    const ids = Array.from(allChatIds)
    fs.writeFileSync(CHAT_IDS_FILE, JSON.stringify(ids, null, 2))
    console.log(`${ids.length} ta chat ID saqlandi`)
  } catch (err) {
    console.error('Chat ID saqlashda xato:', err)
  }
}

// Saytlar holatini tekshirish
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
        status: '❌ Ishlayotmayapti',
        responseTime: 'N/A',
        url: site.url,
        error: err.message
      })
    }
  }
  
  return results
}

// Excel faylini yaratish
async function createExcelFile() {
  try {
    const response = await axios.get(`${backendUrl}/users`)
    const users = response.data
    
    // Excel faylini yaratish
    const wb = xlsx.utils.book_new()
    const ws = xlsx.utils.json_to_sheet(users)
    xlsx.utils.book_append_sheet(wb, ws, "Foydalanuvchilar")
    
    // Vaqtinchalik fayl nomi
    const excelFileName = `users_${moment().format('DDMMYYYY_HHmmss')}.xlsx`
    const tempFilePath = path.join(process.cwd(), excelFileName)
    
    // Faylni saqlash
    xlsx.writeFile(wb, tempFilePath)
    
    return {
      path: tempFilePath,
      usersCount: users.length
    }
    
  } catch (err) {
    console.error('Excel fayli bilan ishlashda xato:', err)
    throw err
  }
}

// Chiroyli formatdagi xabar yaratish
function createMessage(usersCount, websiteResults) {
  const currentTime = moment().format("HH:mm:ss DD.MM.YYYY")
  
  let messageText = `📊 *Avtomatik hisobot* (${currentTime})\n\n`
  messageText += `👥 *Foydalanuvchilar soni:* ${usersCount}\n\n`
  messageText += `🌐 *Saytlar holati:*\n`
  
  websiteResults.forEach(site => {
    messageText += `\n🔹 *${site.name}*\n`
    messageText += `Status: ${site.status}\n`
    messageText += `Javob vaqti: ${site.responseTime}\n`
    messageText += `URL: ${site.url}\n`
  })
  
  messageText += `\n📎 Quyida Excel fayli bilan tanishishingiz mumkin`
  
  return messageText
}

// Xabarni barcha chatlarga jo'natish
async function sendToAllChats(messageText, excelPath) {
  for (const chatId of allChatIds) {
    try {
      // Xabarni jo'natish
      await bot.sendMessage(chatId, messageText, { 
        parse_mode: "Markdown",
        disable_web_page_preview: true
      })
      
      // Excel faylni jo'natish
      await bot.sendDocument(chatId, excelPath)
      
      console.log(`Xabar muvaffaqiyatli jo'natildi: ${chatId}`)
    } catch (error) {
      console.error(`${chatId} ga xabar jo'natishda xato:`, error)
      
      // Agar bot kanal/guruhdan chiqarilgan bo'lsa
      if (error.response?.statusCode === 403) {
        allChatIds.delete(chatId)
        saveChatIds()
        console.log(`Chat ${chatId} ro'yxatdan o'chirildi`)
      }
    }
  }
}

// Dastlabki sozlamalar
initChatIdsFile()

// Bot haqida ma'lumot
let botInfo = null
bot.getMe()
  .then(info => {
    botInfo = info
    console.log("Bot ma'lumotlari:", botInfo)
  })
  .catch(err => console.error("Bot ma'lumotlarini olishda xato:", err))

// Kanalga admin qilish uchun /join kanal_id buyrug'i
bot.onText(/\/join (.+)/, (msg, match) => {
  const chatId = msg.chat.id
  const channelId = match[1]
  
  
  allChatIds.add(channelId)
  saveChatIds()
  bot.sendMessage(chatId, `✅ Kanal (ID: ${channelId}) ro'yxatga qo'shildi!`)
})

// /malumot buyrug'i
bot.onText(/\/malumot/, async (msg) => {
  const chatId = msg.chat.id
  
  try {
    const loadingMsg = await bot.sendMessage(chatId, "⏳ Ma'lumotlar yuklanmoqda...")
    
    // Saytlar holatini tekshirish
    const websiteResults = await checkWebsites()
    
    // Excel faylini yaratish
    const { path: excelPath, usersCount } = await createExcelFile()
    
    // Xabar matnini yaratish
    const messageText = createMessage(usersCount, websiteResults)
    
    await bot.deleteMessage(chatId, loadingMsg.message_id)
    await bot.sendMessage(chatId, messageText, { 
      parse_mode: "Markdown",
      disable_web_page_preview: true
    })
    await bot.sendDocument(chatId, excelPath)
    
    // Faylni o'chirish
    fs.unlink(excelPath, (err) => {
      if (err) console.error('Faylni o\'chirishda xato:', err)
    })
    
  } catch (error) {
    console.error("Xato:", error)
    bot.sendMessage(chatId, "⚠️ Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.")
  }
})

// Har 15 daqiqada avtomatik xabar
cron.schedule('*/15 * * * *', async () => {
  console.log('15 minutlik avtomatik xabar yuborilmoqda...', new Date().toLocaleString())
  
  if (allChatIds.size === 0) {
    console.log('Xabar yuborish uchun chatlar mavjud emas')
    return
  }

  try {
    // Saytlar holatini tekshirish
    const websiteResults = await checkWebsites()
    
    // Excel faylini yaratish
    const { path: excelPath, usersCount } = await createExcelFile()
    
    // Xabar matnini yaratish
    const messageText = createMessage(usersCount, websiteResults)
    
    // Barcha chatlarga jo'natish
    await sendToAllChats(messageText, excelPath)
    
    // Faylni o'chirish
    fs.unlink(excelPath, (err) => {
      if (err) console.error('Faylni o\'chirishda xato:', err)
    })
    
  } catch (error) {
    console.error("Avtomatik xabar yuborishda xato:", error)
  }
}, {
  scheduled: true,
  timezone: "Asia/Tashkent"
})

console.log("✅ Bot muvaffaqiyatli ishga tushdi! Har 15 minutda hisobot yuboradi")