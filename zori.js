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

const backendUrl = "https://b.realexamielts.uz"
const CHAT_IDS_FILE = path.join(process.cwd(), 'chat_ids.json')

// Saytlar ro'yxati
const websites = [
  { name: "Sayt", url: "https://nrb.uz"},
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

// === /statistika komanda ===
bot.onText(/\/statistika/, async (msg) => {
  const chatId = msg.chat.id

  try {
    const loadingMsg = await bot.sendMessage(chatId, "📊 Statistika tayyorlanmoqda...")

    // Foydalanuvchilarni olish
    const response = await axios.get(`${backendUrl}/usercha`)
    const users = response.data

    // Bugungi sana
    const today = moment().format("YYYY-MM-DD")
    const todayUsers = users.filter(u => moment(u.createdAt).format("YYYY-MM-DD") === today)

    // Bugungi lidlarni saytlar bo'yicha guruhlash
    const todaySiteStats = {}
    todayUsers.forEach(user => {
      const siteName = user.full_name || 'Noma\'lum'
      todaySiteStats[siteName] = (todaySiteStats[siteName] || 0) + 1
    })

    // Barcha kunlar bo'yicha statistika
    const dailyStats = {}
    users.forEach(user => {
      const date = moment(user.createdAt).format("DD.MM.YYYY")
      dailyStats[date] = (dailyStats[date] || 0) + 1
    })

    // Sana bo'yicha sortlash
    const sortedDates = Object.keys(dailyStats).sort(
      (a, b) => moment(a, "DD.MM.YYYY") - moment(b, "DD.MM.YYYY")
    )

    // Bugungi sanani topish va o'chirish
    const todayFormatted = moment().format("DD.MM.YYYY")
    const otherDates = sortedDates.filter(date => date !== todayFormatted)

    // === STATISTIKA MATNI ===
    let statText = `📊 *STATISTIKA*\n\n`
    statText += `📈 Jami lidlar: *${users.length}* ta\n`
    statText += `📅 Bugungi lidlar: *${todayUsers.length}* ta\n\n`

    if (Object.keys(todaySiteStats).length > 0) {
      statText += `🌐 *Saytlar bo'yicha (bugungi kun):*\n`
      Object.keys(todaySiteStats).sort().forEach(site => {
        statText += `   ${site} - ${todaySiteStats[site]} ta\n`
      })
      statText += `\n`
    }

    if (otherDates.length > 0) {
      statText += `📆 *Qolgan kunlar bo'yicha lidlar:*\n`
      otherDates.forEach(date => {
        statText += `   ${date}: ${dailyStats[date]} ta\n`
      })
    }

    // === 1-EXCEL: Jami lidlar ro'yxati ===
    const allUsersData = users.map((u, i) => ({
      "№": i + 1,
      "Sayt": u.full_name || 'N/A',
      "Telefon raqam": u.phone_number || 'N/A',
      "Ro'yxatdan o'tgan sana": moment(u.createdAt).format('DD.MM.YYYY HH:mm')
    }))

    const excelPath1 = path.join(process.cwd(), `jami_lidlar_${moment().format("DDMMYYYY_HHmmss")}.xlsx`)
    const wb1 = XLSX.utils.book_new()
    const ws1 = XLSX.utils.json_to_sheet(allUsersData)
    XLSX.utils.book_append_sheet(wb1, ws1, "Jami Lidlar")
    XLSX.writeFile(wb1, excelPath1)

    // === 2-EXCEL: Kunlar va Saytlar bo'yicha batafsil statistika ===
    const wb2 = XLSX.utils.book_new()

    // Sheet 1: Kunlar bo'yicha umumiy statistika
    const dailyStatsData = sortedDates.map((date, i) => ({
      "№": i + 1,
      "Sana": date,
      "Lidlar soni": dailyStats[date]
    }))
    const ws2_1 = XLSX.utils.json_to_sheet(dailyStatsData)
    XLSX.utils.book_append_sheet(wb2, ws2_1, "Kunlik umumiy")

    // Sheet 2: Saytlar bo'yicha kunlik batafsil statistika
    const allSites = new Set()
    
    // Barcha saytlarni to'plash
    users.forEach(u => {
      const siteName = u.full_name || 'Noma\'lum'
      allSites.add(siteName)
    })

    // Saytlar ro'yxatini tartiblash
    const sortedSites = Array.from(allSites).sort()

    // Har bir kun uchun saytlar bo'yicha batafsil statistika
    const detailedSiteStats = []
    
    sortedDates.forEach(date => {
      const dayUsers = users.filter(u => moment(u.createdAt).format("DD.MM.YYYY") === date)
      
      // Har bir sayt uchun kunlik sonni hisoblash
      const siteStats = {}
      sortedSites.forEach(site => {
        siteStats[site] = 0
      })
      
      dayUsers.forEach(user => {
        const siteName = user.full_name || 'Noma\'lum'
        siteStats[siteName] = (siteStats[siteName] || 0) + 1
      })

      // Jami kunlik lidlar
      const dailyTotal = Object.values(siteStats).reduce((sum, count) => sum + count, 0)

      // Qator ma'lumotlari
      const row = { 
        "Sana": date,
        "Jami kunlik": dailyTotal
      }
      
      // Har bir sayt uchun alohida ustun qo'shish
      sortedSites.forEach(site => {
        row[site] = siteStats[site]
      })
      
      detailedSiteStats.push(row)
    })

    const ws2_2 = XLSX.utils.json_to_sheet(detailedSiteStats)
    XLSX.utils.book_append_sheet(wb2, ws2_2, "Kunlik saytlar")

    // Sheet 3: Saytlar bo'yicha umumiy statistika
    const overallSiteStats = []
    
    sortedSites.forEach((site, index) => {
      const siteUsers = users.filter(u => (u.full_name || 'Noma\'lum') === site)
      const siteTotal = siteUsers.length
      
      // Har bir kun uchun sayt statistikasi
      const dailyCounts = {}
      sortedDates.forEach(date => {
        const dayCount = siteUsers.filter(u => 
          moment(u.createdAt).format("DD.MM.YYYY") === date
        ).length
        dailyCounts[date] = dayCount
      })

      overallSiteStats.push({
        "№": index + 1,
        "Sayt nomi": site,
        "Jami lidlar": siteTotal,
        ...dailyCounts
      })
    })

    const ws2_3 = XLSX.utils.json_to_sheet(overallSiteStats)
    XLSX.utils.book_append_sheet(wb2, ws2_3, "Saytlar umumiy")

    // Sheet 4: Bugungi kun statistikasi
    const todayStatsData = [
      { "Ko'rsatkich": "Bugungi sana", "Qiymat": todayFormatted },
      { "Ko'rsatkich": "Jami lidlar", "Qiymat": todayUsers.length }
    ]

    // Har bir sayt uchun bugungi statistikani qo'shish
    Object.keys(todaySiteStats).sort().forEach(site => {
      todayStatsData.push({
        "Ko'rsatkich": site,
        "Qiymat": todaySiteStats[site]
      })
    })

    const ws2_4 = XLSX.utils.json_to_sheet(todayStatsData)
    XLSX.utils.book_append_sheet(wb2, ws2_4, "Bugungi kun")

    const excelPath2 = path.join(process.cwd(), `statistika_${moment().format("DDMMYYYY_HHmmss")}.xlsx`)
    XLSX.writeFile(wb2, excelPath2)

    // Loading xabarini o'chirish
    await bot.deleteMessage(chatId, loadingMsg.message_id)

    // Statistika matnini yuborish
    await bot.sendMessage(chatId, statText, { parse_mode: "Markdown" })

    // Fayllarni yuborish
    await bot.sendDocument(chatId, fs.createReadStream(excelPath1), {
      caption: "📋 Jami lidlar ro'yxati"
    })
    
    await bot.sendDocument(chatId, fs.createReadStream(excelPath2), {
      caption: `📊 Batafsil statistika:\n• Kunlik umumiy\n• Kunlik saytlar kesimida\n• Saytlar bo'yicha umumiy\n• Bugungi kun`
    })

    // Fayllarni o'chirish
    fs.unlinkSync(excelPath1)
    fs.unlinkSync(excelPath2)

  } catch (error) {
    console.error("❌ Statistika olishda xato:", error)
    bot.sendMessage(chatId, "⚠️ Statistika olishda xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.")
  }
})

// Dastlabki sozlamalar
initChatIdsFile()

console.log("✅ Bot muvaffaqiyatli ishga tushdi!")