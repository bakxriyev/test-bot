import dotenv from 'dotenv'
dotenv.config()

import TelegramBot from 'node-telegram-bot-api'
import axios from 'axios'
import moment from 'moment'
import fs from 'fs'
import path from 'path'
import cron from 'node-cron'

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

// Text faylini yaratish
// Text faylini yaratish (jadval ko‘rinishida)
// Text faylini yaratish (jadval formatida)
// Text faylini yaratish (jadval formatida)
async function createTextFile() {
  try {
    console.log("API dan foydalanuvchilar ma'lumotlari olinmoqda...");
    const response = await axios.get(`${backendUrl}/users`, {
      timeout: 30000,
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    if (!response.data || !Array.isArray(response.data)) {
      throw new Error("API dan noto'g'ri formatda ma'lumot qaytmoqda");
    }

    const users = response.data;
    console.log(`API dan qaytgan foydalanuvchilar soni: ${users.length}`);

    // Text fayl nomi va yo‘li
    const textFileName = `users_${moment().format('DDMMYYYY_HHmmss')}.txt`;
    const tempFilePath = path.join(process.cwd(), textFileName);

    // Jadval sarlavhasi
    let fileContent = `📋 Foydalanuvchilar ro'yxati (${moment().format('DD.MM.YYYY HH:mm:ss')})\n`;
    fileContent += `Jami foydalanuvchilar: ${users.length}\n\n`;

    fileContent += `|  №  |      ID      |       Ism       |    Tel raqam    |     TG username     |\n`;
    fileContent += `|-----|--------------|-----------------|------------------|----------------------|\n`;

    users.forEach((user, index) => {
      const id = user.id || 'N/A';
      const name = user.full_name || 'N/A';
      const phone = user.phone_number || 'N/A';
      const tg_user = user.tg_user || 'N/A';

      // Har bir ustunni aniqlik bilan formatlab yozamiz
      fileContent += `| ${String(index + 1).padEnd(3)} | ${String(id).padEnd(12)} | ${name.padEnd(15)} | ${phone.padEnd(16)} | ${tg_user.padEnd(20)} |\n`;
    });

    // Faylga yozish
    fs.writeFileSync(tempFilePath, fileContent, 'utf8');

    // Fayl hajmini ko‘rish
    const stats = fs.statSync(tempFilePath);
    console.log(`✅ Text fayl yaratildi (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);

    return {
      path: tempFilePath,
      usersCount: users.length
    };

  } catch (err) {
    console.error("❌ Text fayl yaratishda xatolik:", err.message);
    throw err;
  }
}
 

// Chiroyli formatdagi xabar yaratish
function createMessage(usersCount, websiteResults) {
  const currentTime = moment().format("HH:mm:ss DD.MM.YYYY")
  
  let messageText = `📊 *15 minutlik avtomatik hisobot* (${currentTime})\n\n`
  messageText += `👥 *Foydalanuvchilar soni:* ${usersCount}\n\n`
  messageText += `🌐 *Saytlar holati:*\n`
  
  websiteResults.forEach(site => {
    messageText += `\n🔹 *${site.name}*\n`
    messageText += `Status: ${site.status}\n`
    messageText += `Javob vaqti: ${site.responseTime}\n`
    messageText += `URL: ${site.url}\n`
  })
  
  messageText += `\n📎 Quyida to'liq foydalanuvchilar ro'yxati bilan tanishishingiz mumkin`
  
  return messageText
}

// Xabarni barcha chatlarga jo'natish
async function sendToAllChats(messageText, filePath) {
  for (const chatId of allChatIds) {
    try {
      // Fayl hajmini tekshirish
      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        throw new Error("Text fayli bo'sh yaratilgan");
      }

      console.log(`Xabar jo'natilmoqda ${chatId} ga...`);
      
      // Xabarni jo'natish
      await bot.sendMessage(chatId, messageText, { 
        parse_mode: "Markdown",
        disable_web_page_preview: true
      });
      
      // Faylni jo'natish
      const fileStream = fs.createReadStream(filePath);
      await bot.sendDocument(chatId, fileStream, {}, {
        filename: path.basename(filePath),
        contentType: 'text/plain'
      });
      
      console.log(`Xabar muvaffaqiyatli jo'natildi: ${chatId}`);
    } catch (error) {
      console.error(`${chatId} ga xabar jo'natishda xato:`, error);
      
      // Agar bot kanal/guruhdan chiqarilgan bo'lsa
      if (error.response?.statusCode === 403) {
        allChatIds.delete(chatId);
        saveChatIds();
        console.log(`Chat ${chatId} ro'yxatdan o'chirildi`);
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
    
    // Text faylini yaratish
    const { path: filePath, usersCount } = await createTextFile()
    
    // Xabar matnini yaratish
    const messageText = createMessage(usersCount, websiteResults)
    
    await bot.deleteMessage(chatId, loadingMsg.message_id)
    await bot.sendMessage(chatId, messageText, { 
      parse_mode: "Markdown",
      disable_web_page_preview: true
    })
    
    // Faylni jo'natish
    const fileStream = fs.createReadStream(filePath)
    await bot.sendDocument(chatId, fileStream, {}, {
      filename: path.basename(filePath),
      contentType: 'text/plain'
    })
    
    // Faylni o'chirish
    fs.unlink(filePath, (err) => {
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
    
    // Text faylini yaratish
    const { path: filePath, usersCount } = await createTextFile()
    
    // Xabar matnini yaratish
    const messageText = createMessage(usersCount, websiteResults)
    
    // Barcha chatlarga jo'natish
    await sendToAllChats(messageText, filePath)
    
    // Faylni o'chirish
    fs.unlink(filePath, (err) => {
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