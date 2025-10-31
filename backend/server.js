const express = require('express');
const QRCode = require('qrcode');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: ['https://dedovichmax.github.io', 'http://localhost:3000'],
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// In-memory хранилище сессий
const sessions = new Map();

// Очистка старых сессий каждые 5 минут
setInterval(() => {
    const now = Date.now();
    let deletedCount = 0;

    for (const [sessionId, session] of sessions.entries()) {
        // Удаляем сессии старше 30 минут
        if (now - session.createdAt > 30 * 60 * 1000) {
            sessions.delete(sessionId);
            deletedCount++;
        }
    }

    if (deletedCount > 0) {
        console.log(`🧹 Очищено ${deletedCount} устаревших сессий`);
    }
}, 5 * 60 * 1000);

// Генерация QR-кода
app.post('/api/generate-qr', async (req, res) => {
    try {
        const { phone } = req.body;

        // Улучшенная валидация для международных номеров
        const cleanPhone = phone.replace(/\D/g, '');

        if (!cleanPhone || cleanPhone.length < 8 || cleanPhone.length > 15) {
            return res.status(400).json({
                success: false,
                error: 'Введите корректный номер телефона (8-15 цифр)'
            });
        }

        // Форматируем номер для хранения
        const formattedPhone = `+${cleanPhone}`;

        // Создаем сессию в памяти
        const sessionId = generateSessionId();
        const session = {
            phone: formattedPhone,
            verified: false,
            createdAt: Date.now(),
            verifiedAt: null
        };

        sessions.set(sessionId, session);
        console.log(`📱 Создана сессия ${sessionId} для номера ${formattedPhone}`);

        // Данные для QR-кода
        const qrData = JSON.stringify({
            type: 'phone_verification',
            session_id: sessionId,
            phone: formattedPhone,
            timestamp: Date.now()
        });

        // Генерируем QR-код
        const qrCode = await QRCode.toDataURL(qrData, {
            width: 400,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        res.json({
            success: true,
            session_id: sessionId,
            qr_code: qrCode,
            phone: formattedPhone,
            expires_in: '30 минут'
        });

    } catch (error) {
        console.error('❌ Ошибка генерации QR:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при создании QR-кода'
        });
    }
});

// Проверка статуса сессии
app.get('/api/session/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = sessions.get(sessionId);

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Сессия не найдена или устарела'
            });
        }

        res.json({
            success: true,
            phone: session.phone,
            verified: session.verified,
            verified_at: session.verifiedAt,
            created_at: session.createdAt
        });
    } catch (error) {
        console.error('❌ Ошибка проверки сессии:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при проверке сессии'
        });
    }
});

// Подтверждение номера через сканирование
app.post('/api/verify-scan', (req, res) => {
    try {
        const { session_id, scanned_phone } = req.body;

        if (!session_id || !scanned_phone) {
            return res.status(400).json({
                success: false,
                error: 'Отсутствуют необходимые данные'
            });
        }

        const session = sessions.get(session_id);

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Сессия не найдена'
            });
        }

        if (session.verified) {
            return res.json({
                success: true,
                message: 'Номер уже подтвержден',
                phone: session.phone
            });
        }

        // Проверяем совпадение номеров
        if (session.phone !== scanned_phone) {
            return res.status(400).json({
                success: false,
                error: 'Номера не совпадают'
            });
        }

        // Подтверждаем сессию
        session.verified = true;
        session.verifiedAt = Date.now();
        sessions.set(session_id, session);

        console.log(`✅ Номер ${session.phone} подтвержден через сессию ${session_id}`);

        res.json({
            success: true,
            message: 'Номер успешно подтвержден',
            phone: session.phone,
            verified_at: session.verifiedAt
        });

    } catch (error) {
        console.error('❌ Ошибка подтверждения:', error);
        res.status(500).json({
            success: false,
            error: 'Ошибка при подтверждении номера'
        });
    }
});

// Получение списка активных сессий (для отладки)
app.get('/api/sessions', (req, res) => {
    const now = Date.now();
    const activeSessions = [];

    for (const [sessionId, session] of sessions.entries()) {
        if (now - session.createdAt < 30 * 60 * 1000) {
            activeSessions.push({
                session_id: sessionId,
                phone: session.phone,
                verified: session.verified,
                created_at: new Date(session.createdAt).toLocaleString('ru-RU'),
                verified_at: session.verifiedAt ? new Date(session.verifiedAt).toLocaleString('ru-RU') : null,
                age_seconds: Math.round((now - session.createdAt) / 1000)
            });
        }
    }

    res.json({
        success: true,
        count: activeSessions.length,
        total_in_memory: sessions.size,
        sessions: activeSessions
    });
});

// Статус сервера
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        status: '🟢 Сервер работает',
        uptime: Math.round(process.uptime()) + ' сек',
        active_sessions: sessions.size,
        memory_usage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB'
    });
});

// Вспомогательные функции
function generateSessionId() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📱 Откройте в браузере: http://localhost:${PORT}`);
    console.log(`📊 Статус сервера: http://localhost:${PORT}/api/status`);
    console.log(`🔍 Активные сессии: http://localhost:${PORT}/api/sessions`);
});

// Обработка graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Сервер останавливается...');
    console.log(`💾 Всего сессий в памяти: ${sessions.size}`);
    process.exit(0);
});