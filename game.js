// game.js

import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

// --- DOM Elements ---
const screens = {
    menu: document.getElementById('main-menu'),
    game: document.getElementById('game-screen'),
    leaderboard: document.getElementById('leaderboard-screen'),
    options: document.getElementById('options-screen'),
    credits: document.getElementById('credits-screen')
};

const btns = {
    start: document.getElementById('btn-start'),
    leaderboard: document.getElementById('btn-leaderboard'),
    options: document.getElementById('btn-options'),
    credits: document.getElementById('btn-credits'),
    backLb: document.getElementById('btn-back-lb'),
    backOpt: document.getElementById('btn-back-opt'),
    backCred: document.getElementById('btn-back-cred'),
    quit: document.getElementById('btn-quit'),
    modalOk: document.getElementById('btn-modal-ok')
};

const inputs = {
    mosquito: document.getElementById('input-mosquito'),
    bgm: document.getElementById('input-bgm'),
    swatSound: document.getElementById('input-swat-sound'),
    clickSound: document.getElementById('input-click-sound')
};

const gameUI = {
    score: document.getElementById('score'),
    timer: document.getElementById('timer'),
    mosquito: document.getElementById('mosquito'),
    gameOverModal: document.getElementById('game-over-modal'),
    finalScore: document.getElementById('final-score'),
    finalUsername: document.getElementById('final-username'),
    cursor: document.getElementById('hand-cursor')
};

const video = document.getElementById('webcam');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

// --- Asset State ---
const audioSystem = {
    bgm: null,
    swat: null,
    click: null
};

// --- Global State ---
let handLandmarker = undefined;
let webcamRunning = false;
let lastVideoTime = -1;
let gameState = 'MENU'; // MENU, PLAYING, GAMEOVER
let score = 0;
let timeLeft = 60;
let gameTimer = null;
let mosquitoPos = { x: 50, y: 50 }; // percentages
let mosquitoVelocity = { dx: 0, dy: 0 };
let mosquitoSpeed = 0.5;
let animationFrameId;

// --- Initialize MediaPipe ---
async function initializeHandTracking() {
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 2
        });
        console.log("HandLandmarker loaded");
    } catch (error) {
        console.error("Error loading MediaPipe:", error);
    }
}
initializeHandTracking();

// --- File Handlers ---
function handleFileInput(inputElement, callback) {
    inputElement.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const tempUrl = URL.createObjectURL(file);
            callback(tempUrl);
        }
    });
}

// Setup custom assets
handleFileInput(inputs.mosquito, (url) => {
    gameUI.mosquito.style.backgroundImage = `url('${url}')`;
});

handleFileInput(inputs.bgm, (url) => {
    if (audioSystem.bgm) {
        audioSystem.bgm.pause();
    }
    audioSystem.bgm = new Audio(url);
    audioSystem.bgm.loop = true;
    audioSystem.bgm.volume = 0.5;
});

handleFileInput(inputs.swatSound, (url) => {
    audioSystem.swat = new Audio(url);
});

handleFileInput(inputs.clickSound, (url) => {
    audioSystem.click = new Audio(url);
});

function playClickSound() {
    if (audioSystem.click) {
        // Clone to allow rapid clicking
        const sound = audioSystem.click.cloneNode(true);
        sound.volume = 0.8;
        sound.play().catch(e => console.log('Audio play error:', e));
    }
}

// --- Navigation ---
function showScreen(screenName) {
    playClickSound();
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
    gameState = screenName === 'game' ? 'PLAYING' : 'MENU';
}

btns.start.addEventListener('click', startGame);
btns.leaderboard.addEventListener('click', () => { showScreen('leaderboard'); updateLeaderboardUI(); });
btns.options.addEventListener('click', () => showScreen('options'));
btns.credits.addEventListener('click', () => showScreen('credits'));
btns.backLb.addEventListener('click', () => showScreen('menu'));
btns.backOpt.addEventListener('click', () => showScreen('menu'));
btns.backCred.addEventListener('click', () => showScreen('menu'));
btns.quit.addEventListener('click', quitGame);
btns.modalOk.addEventListener('click', () => {
    gameUI.gameOverModal.classList.add('hidden');
    showScreen('menu');
});

// --- Game Logic ---
async function startGame() {
    showScreen('game');
    score = 0;
    timeLeft = 60;
    mosquitoSpeed = 0.5;
    gameUI.score.innerText = score;
    gameUI.timer.innerText = timeLeft;
    gameUI.mosquito.classList.remove('hidden');
    gameUI.cursor.classList.remove('hidden');

    spawnMosquito();

    // Start BGM
    if (audioSystem.bgm) {
        audioSystem.bgm.play().catch(e => console.log('BGM play error:', e));
    }

    // Start Camera
    if (!webcamRunning) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            video.srcObject = stream;
            video.addEventListener("loadeddata", predictWebcam);
            webcamRunning = true;
        } catch (err) {
            console.error("Camera access denied", err);
            alert("Camera access is required to play.");
            quitGame();
            return;
        }
    }

    // Start Timer
    gameTimer = setInterval(() => {
        timeLeft--;
        gameUI.timer.innerText = timeLeft;
        if (timeLeft <= 0) {
            endGame();
        }
    }, 1000);
}

function quitGame() {
    clearInterval(gameTimer);
    gameUI.mosquito.classList.add('hidden');
    gameUI.cursor.classList.add('hidden');
    showScreen('menu');
    // We could stop the camera here, but let's keep it hot for faster restarts
}

function endGame() {
    clearInterval(gameTimer);
    gameState = 'GAMEOVER';
    gameUI.mosquito.classList.add('hidden');
    gameUI.cursor.classList.add('hidden');

    // Process Score and Leaderboard
    const username = generateUsername();
    saveScore(username, score);

    // Stop BGM
    if (audioSystem.bgm) {
        audioSystem.bgm.pause();
        audioSystem.bgm.currentTime = 0;
    }

    gameUI.finalScore.innerText = score;
    gameUI.finalUsername.innerText = username;
    gameUI.gameOverModal.classList.remove('hidden');
}

// --- Mosquito Mechanics ---
function spawnMosquito() {
    // Random position avoiding edges (10% to 90%)
    mosquitoPos.x = 10 + Math.random() * 80;
    mosquitoPos.y = 10 + Math.random() * 80;
    updateMosquitoTransform();
    pickNewDirection();
}

function pickNewDirection() {
    const angle = Math.random() * Math.PI * 2;
    mosquitoVelocity.dx = Math.cos(angle) * mosquitoSpeed;
    mosquitoVelocity.dy = Math.sin(angle) * mosquitoSpeed;
}

function updateMosquito() {
    if (gameState !== 'PLAYING') return;

    // Move
    mosquitoPos.x += mosquitoVelocity.dx;
    mosquitoPos.y += mosquitoVelocity.dy;

    // Bounce off edges
    if (mosquitoPos.x <= 5 || mosquitoPos.x >= 95) {
        mosquitoVelocity.dx *= -1;
        mosquitoPos.x = Math.max(5, Math.min(95, mosquitoPos.x));
    }
    if (mosquitoPos.y <= 5 || mosquitoPos.y >= 95) {
        mosquitoVelocity.dy *= -1;
        mosquitoPos.y = Math.max(5, Math.min(95, mosquitoPos.y));
    }

    // Occasional random direction change
    if (Math.random() < 0.02) {
        pickNewDirection();
    }

    updateMosquitoTransform();
}

function updateMosquitoTransform() {
    gameUI.mosquito.style.left = `${mosquitoPos.x}%`;
    gameUI.mosquito.style.top = `${mosquitoPos.y}%`;
}

// --- Tracking & Collision ---
async function predictWebcam() {
    canvasElement.style.width = video.videoWidth + "px";
    canvasElement.style.height = video.videoHeight + "px";
    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;

    if (gameState === 'PLAYING' && handLandmarker && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const results = handLandmarker.detectForVideo(video, performance.now());

        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

        // Mirror the canvas context to match the mirrored video
        canvasCtx.translate(canvasElement.width, 0);
        canvasCtx.scale(-1, 1);

        if (results.landmarks && results.landmarks.length > 0) {
            // Visualize hand landmarks (optional, maybe just show cursor instead to be cleaner)
            // For now, let's just get the index finger tip (landmark 8)
            const indexTip = results.landmarks[0][8];

            // Normalize coordinates (0-1) -> to screen percentages (0-100)
            // Note: Since video is mirrored visually, X is 1 - x
            const cursorX = (1 - indexTip.x) * 100;
            const cursorY = indexTip.y * 100;

            gameUI.cursor.style.left = `${cursorX}%`;
            gameUI.cursor.style.top = `${cursorY}%`;

            checkCollision(cursorX, cursorY);
        } else {
            // Hide cursor if no hand
            gameUI.cursor.style.left = `-100%`;
        }
        canvasCtx.restore();
    }

    updateMosquito();

    // Loop
    if (webcamRunning) {
        animationFrameId = window.requestAnimationFrame(predictWebcam);
    }
}

let lastSwatTime = 0;
function checkCollision(handX, handY) {
    const now = Date.now();
    if (now - lastSwatTime < 300) return; // Cooldown for swatting

    // Calculate distance between hand tip and mosquito center
    const dx = handX - mosquitoPos.x;
    const dy = handY - mosquitoPos.y;
    // rough aspect ratio correction, screen width/height is usually 16:9, let's assume square distance for now
    const distanceSquared = dx * dx + dy * dy;

    // Hit radius (Increased to roughly 15% of screen for easier swatting)
    if (distanceSquared < 225) {
        handleSwat();
        lastSwatTime = now;

        // Visual indicator
        gameUI.cursor.classList.add('swatting');
        setTimeout(() => gameUI.cursor.classList.remove('swatting'), 150);
    }
}

function handleSwat() {
    score++;
    gameUI.score.innerText = score;

    // Increase difficulty
    mosquitoSpeed = 0.5 + (score * 0.1);

    // Play Swat Sound
    if (audioSystem.swat) {
        const sound = audioSystem.swat.cloneNode(true);
        sound.volume = 1.0;
        sound.play().catch(e => console.log('Swat sound error:', e));
    }

    spawnMosquito();
}

// --- Leaderboard System ---
const ADJECTIVES = ["Swift", "Silent", "Deadly", "Crazy", "Lucky", "Ninja", "Flying", "Mighty"];
const NOUNS = ["Swatter", "Hunter", "Smacker", "Ninja", "Bear", "Cat", "Eagle", "Frog"];

function generateUsername() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const num = Math.floor(Math.random() * 1000);
    return `${adj}${noun}${num}`;
}

function getLeaderboard() {
    const lb = localStorage.getItem('mosquito_leaderboard');
    return lb ? JSON.parse(lb) : [];
}

function saveScore(username, score) {
    const lb = getLeaderboard();
    lb.push({ username, score });
    // Sort descending
    lb.sort((a, b) => b.score - a.score);
    // Keep top 10
    if (lb.length > 10) {
        lb.length = 10;
    }
    localStorage.setItem('mosquito_leaderboard', JSON.stringify(lb));
}

function updateLeaderboardUI() {
    const lb = getLeaderboard();
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';

    if (lb.length === 0) {
        list.innerHTML = '<li>No scores yet. Get swatting!</li>';
        return;
    }

    lb.forEach((entry, index) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>#${index + 1} ${entry.username}</span> <span>${entry.score} pts</span>`;
        list.appendChild(li);
    });
}
