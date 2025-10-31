class PhoneVerifyApp {
    constructor() {
        this.currentSessionId = null;
        this.videoStream = null;
        this.isCameraActive = false;
        this.statusCheckInterval = null;
        this.API_BASE = window.location.origin;

        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Автоформатирование номера телефона
        const phoneInput = document.getElementById('phoneInput');
        phoneInput.addEventListener('input', (e) => {
            this.formatPhoneInput(e.target);
        });

        // Enter для генерации QR-кода
        phoneInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.generateQRCode();
            }
        });
    }

    formatPhoneInput(input) {
        const numbers = input.value.replace(/\D/g, '');
        let formatted = '';

        if (numbers.length === 0) return '';

        // Упрощенное форматирование для международных номеров
        if (numbers.length <= 3) {
            formatted = `+${numbers}`;
        } else if (numbers.length <= 6) {
            formatted = `+${numbers.slice(0, 3)} ${numbers.slice(3)}`;
        } else if (numbers.length <= 9) {
            formatted = `+${numbers.slice(0, 3)} ${numbers.slice(3, 6)} ${numbers.slice(6)}`;
        } else if (numbers.length <= 12) {
            formatted = `+${numbers.slice(0, 3)} ${numbers.slice(3, 6)} ${numbers.slice(6, 9)} ${numbers.slice(9)}`;
        } else {
            formatted = `+${numbers.slice(0, 3)} ${numbers.slice(3, 6)} ${numbers.slice(6, 9)} ${numbers.slice(9, 12)} ${numbers.slice(12, 15)}`;
        }

        input.value = formatted;
    }

    async generateQRCode() {
        const phoneInput = document.getElementById('phoneInput');
        const phone = phoneInput.value.replace(/\D/g, '');
        const generateBtn = document.getElementById('generateBtn');

        // Улучшенная валидация для международных номеров
        if (!phone || phone.length < 8 || phone.length > 15) {
            this.showError('Введите корректный номер телефона (от 8 до 15 цифр)');
            return;
        }

        generateBtn.disabled = true;
        generateBtn.textContent = 'Создание...';

        try {
            const response = await fetch(`${this.API_BASE}/api/generate-qr`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ phone: phone })
            });

            const data = await response.json();

            if (data.success) {
                this.currentSessionId = data.session_id;

                // Показываем QR-код и информацию
                document.getElementById('qrImage').src = data.qr_code;
                document.getElementById('phoneDisplay').textContent = data.phone;
                document.getElementById('sessionDisplay').textContent = data.session_id;
                document.getElementById('expiryDisplay').textContent = data.expires_in;

                // Переходим к шагу 2
                this.showStep(2);

                // Запускаем проверку статуса
                this.startStatusChecking();

            } else {
                this.showError(data.error || 'Ошибка при создании QR-кода');
            }
        } catch (error) {
            this.showError('Ошибка соединения с сервером');
            console.error('QR generation error:', error);
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = 'Создать QR-код';
        }
    }

    startStatusChecking() {
        // Останавливаем предыдущий интервал, если был
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
        }

        this.statusCheckInterval = setInterval(async () => {
            if (!this.currentSessionId) return;

            try {
                const response = await fetch(`${this.API_BASE}/api/session/${this.currentSessionId}`);
                const data = await response.json();

                if (data.success && data.verified) {
                    this.showFinalResult(data.phone, true);
                    clearInterval(this.statusCheckInterval);
                }
            } catch (error) {
                console.error('Status check error:', error);
            }
        }, 2000);
    }

    async startQRScanning() {
        this.showStep(3);
        await this.initializeCamera();
    }

    async initializeCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: "environment",
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });

            const video = document.getElementById('video');
            this.videoStream = stream;
            video.srcObject = stream;
            this.isCameraActive = true;

            await video.play();
            this.startQRDetection();

        } catch (err) {
            this.showScanError(`Ошибка доступа к камере: ${err.message}`);
        }
    }

    startQRDetection() {
        const video = document.getElementById('video');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const detectQR = () => {
            if (!this.isCameraActive) return;

            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height);

                if (code) {
                    try {
                        const data = JSON.parse(code.data);
                        if (data.session_id && data.phone) {
                            this.handleScannedQR(data.session_id, data.phone);
                        }
                    } catch (e) {
                        // Неверный QR-код - игнорируем
                    }
                }
            }
            requestAnimationFrame(detectQR);
        };

        detectQR();
    }

    async handleScannedQR(sessionId, phone) {
        try {
            const response = await fetch(`${this.API_BASE}/api/verify-scan`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    session_id: sessionId,
                    scanned_phone: phone
                })
            });

            const result = await response.json();

            if (result.success) {
                this.stopCamera();
                this.showFinalResult(result.phone, false);
            } else {
                this.showScanError(result.error);
            }
        } catch (error) {
            this.showScanError('Ошибка при подтверждении номера');
        }
    }

    showStep(stepNumber) {
        // Скрываем все шаги
        document.querySelectorAll('.step').forEach(step => {
            step.classList.remove('active');
        });

        // Показываем нужный шаг
        const stepElement = document.getElementById(`step${stepNumber}`);
        if (stepElement) {
            stepElement.classList.add('active');
        }

        // Скрываем результат
        document.getElementById('resultSection').classList.add('hidden');
    }

    resetToStep1() {
        this.currentSessionId = null;
        this.stopCamera();

        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
            this.statusCheckInterval = null;
        }

        document.getElementById('phoneInput').value = '';
        this.showStep(1);
    }

    stopCamera() {
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => track.stop());
            this.videoStream = null;
        }
        this.isCameraActive = false;
    }

    stopCameraAndReturn() {
        this.stopCamera();
        this.showStep(2);
    }

    toggleCamera() {
        const toggleBtn = document.getElementById('cameraToggle');

        if (this.isCameraActive) {
            this.stopCamera();
            toggleBtn.textContent = 'Включить камеру';
        } else {
            this.initializeCamera();
            toggleBtn.textContent = 'Выключить камеру';
        }
    }

    showFinalResult(phone, isScanner) {
        this.stopCamera();

        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
        }

        const resultSection = document.getElementById('resultSection');
        const resultCard = document.getElementById('resultCard');
        const resultPhone = document.getElementById('resultPhone');
        const resultMessage = document.getElementById('resultMessage');

        resultPhone.textContent = `Телефон: ${phone}`;
        resultMessage.textContent = isScanner
            ? 'Вы успешно отсканировали QR-код и подтвердили номер телефона.'
            : 'Ваш номер телефона был успешно подтвержден через сканирование QR-кода.';

        // Скрываем все шаги
        document.querySelectorAll('.step').forEach(step => {
            step.classList.remove('active');
        });

        // Показываем результат
        resultSection.classList.remove('hidden');
    }

    showError(message) {
        alert(`❌ ${message}`);
    }

    showScanError(message) {
        const scanResult = document.getElementById('scanResult');
        scanResult.innerHTML = `
            <div class="status-pending" style="background: #f8d7da; color: #721c24; border-color: #f5c6cb;">
                ❌ ${message}
            </div>
        `;
    }
}

// Глобальные функции для вызова из HTML
let app;

function generateQRCode() {
    app.generateQRCode();
}

function startQRScanning() {
    app.startQRScanning();
}

function resetToStep1() {
    app.resetToStep1();
}

function stopCameraAndReturn() {
    app.stopCameraAndReturn();
}

function toggleCamera() {
    app.toggleCamera();
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    app = new PhoneVerifyApp();
    console.log('📱 Phone Verify App initialized');
});