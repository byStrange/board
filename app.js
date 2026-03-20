/**
 * MR Board - Ultimate Figma Pro Logic
 * Version: 2.0
 */

// 1. FIREBASE KONFIGURATSIYASI (O'zingiznikini qo'yishingiz mumkin)
const firebaseConfig = {
    apiKey: "AIzaSyDvbG7fChb2LN_nJhwTF1iMKMXNPcuGk5Y",
    databaseURL: "https://tictactoe-26434-default-rtdb.firebaseio.com",
    projectId: "tictactoe-26434",
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// 2. STATE (ILOVA HOLATI)
const State = {
    userId: 'user_' + Math.random().toString(36).substr(2, 6),
    roomId: null,
    roomRef: null,
    
    // Asboblar
    tool: 'draw',
    color: '#0d99ff',
    size: 4,
    opacity: 1,
    
    // Canvas & Viewport
    isDrawing: false,
    lastPos: { x: 0, y: 0 },
    scale: 1,
    offset: { x: 0, y: 0 },
    
    // Ma'lumotlar
    elements: [],       // Barcha obyektlar
    activePaths: {},    // Hozir chizilayotgan chiziqlar (Realtime)
    history: [],        // Undo uchun
    historyIndex: -1,
    
    // Text & Image
    selectedImgId: null,
    isDragging: false,
    dragOffset: { x: 0, y: 0 }
};

// 3. CORE ENGINE (CANVAS MANTIQI)
const Engine = {
    canvas: document.getElementById('canvas'),
    ctx: document.getElementById('canvas').getContext('2d', { alpha: false }),
    raf: null,

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.setupInteractions();
        this.renderReq();
    },

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.renderReq();
    },

    // Koordinatalarni dunyo (canvas) koordinatasiga o'tkazish
    screenToWorld(x, y) {
        return {
            x: (x - State.offset.x) / State.scale,
            y: (y - State.offset.y) / State.scale
        };
    },

    setTool(t) {
        State.tool = t;
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-tool="${t}"]`).classList.add('active');
        this.canvas.style.cursor = t === 'pan' ? 'grab' : 'crosshair';
    },

    // --- SICHQONCHA VA TOUCH HODISALARI ---
    setupInteractions() {
        this.canvas.addEventListener('pointerdown', e => this.onStart(e));
        window.addEventListener('pointermove', e => this.onMove(e));
        window.addEventListener('pointerup', () => this.onEnd());
        this.canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    },

    onStart(e) {
        const world = this.screenToWorld(e.clientX, e.clientY);
        State.lastPos = { x: e.clientX, y: e.clientY };

        if (State.tool === 'pan') {
            State.isDrawing = true;
            return;
        }

        if (State.tool === 'text') {
            this.showTextInput(e.clientX, e.clientY, world);
            return;
        }

        State.isDrawing = true;
        
        if (State.tool === 'draw' || State.tool === 'erase') {
            this.currentPathId = State.userId + '_' + Date.now();
            const color = State.tool === 'erase' ? '#1e1e1e' : State.color;
            const strokeColor = this.hexToRGBA(color, State.opacity);
            
            const newPath = {
                id: this.currentPathId,
                type: 'path',
                points: [world],
                color: strokeColor,
                size: State.size / State.scale
            };
            
            if (State.roomRef) State.roomRef.child('activePaths').child(this.currentPathId).set(newPath);
        }
    },

    onMove(e) {
        if (!State.isDrawing) return;

        const world = this.screenToWorld(e.clientX, e.clientY);

        if (State.tool === 'pan') {
            State.offset.x += e.clientX - State.lastPos.x;
            State.offset.y += e.clientY - State.lastPos.y;
            State.lastPos = { x: e.clientX, y: e.clientY };
            this.renderReq();
            return;
        }

        if (this.currentPathId && State.roomRef) {
            State.roomRef.child('activePaths').child(this.currentPathId).child('points').push(world);
        }
    },

    onEnd() {
        if (this.currentPathId && State.roomRef) {
            // Chizib bo'lingach, asosiy bazaga ko'chirish
            State.roomRef.child('activePaths').child(this.currentPathId).once('value', s => {
                if (s.exists()) {
                    State.roomRef.child('elements').push(s.val());
                    State.roomRef.child('activePaths').child(this.currentPathId).remove();
                }
            });
        }
        State.isDrawing = false;
        this.currentPathId = null;
    },

    onWheel(e) {
        e.preventDefault();
        const mouse = this.screenToWorld(e.clientX, e.clientY);
        const zoomSpeed = 0.001;
        const delta = -e.deltaY;
        const factor = Math.pow(1.1, delta / 100);
        
        const newScale = Math.min(Math.max(State.scale * factor, 0.1), 10);
        
        State.offset.x = e.clientX - mouse.x * newScale;
        State.offset.y = e.clientY - mouse.y * newScale;
        State.scale = newScale;
        
        this.renderReq();
    },

    // --- RENDER (CHIZISH) ---
    renderReq() {
        if (!this.raf) {
            this.raf = requestAnimationFrame(() => {
                this.draw();
                this.raf = null;
            });
        }
    },

    draw() {
        const { ctx, canvas } = this;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.setTransform(State.scale, 0, 0, State.scale, State.offset.x, State.offset.y);

        // Barcha elementlarni chizish
        const allElements = [...State.elements, ...Object.values(State.activePaths)];
        
        allElements.forEach(el => {
            if (el.type === 'path') this.drawPath(el);
            if (el.type === 'text') this.drawText(el);
        });

        document.getElementById('zoomDisplay').innerText = Math.round(State.scale * 100) + '%';
    },

    drawPath(path) {
        if (!path.points || path.points.length < 2) return;
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.strokeStyle = path.color;
        ctx.lineWidth = path.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
            ctx.lineTo(path.points[i].x, path.points[i].y);
        }
        ctx.stroke();
    },

    // --- FUNKSIYALAR ---
    zoomIn() { State.scale *= 1.2; this.renderReq(); },
    zoomOut() { State.scale /= 1.2; this.renderReq(); },
    centerView() { State.scale = 1; State.offset = {x:0, y:0}; this.renderReq(); },

    uploadImage() {
        document.getElementById('imageInput').click();
        document.getElementById('imageInput').onchange = e => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                // Rasm yuklash mantiqi (base64 yoki storage)
                console.log("Rasm yuklandi");
            };
            reader.readAsDataURL(file);
        };
    },

    clearBoard() {
        if (State.roomRef) {
            State.roomRef.child('elements').remove();
            UI.closeModal('clearModal');
        }
    },

    hexToRGBA(hex, alpha) {
        let r = parseInt(hex.slice(1, 3), 16),
            g = parseInt(hex.slice(3, 5), 16),
            b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
};

// 4. UI CONTROLLER (INTERFEYS)
const UI = {
    init() {
        this.setupColors();
        this.setupSliders();
        Engine.init();
    },

    showModal(id) { document.getElementById(id).classList.add('show'); },
    closeModal(id) { document.getElementById(id).classList.remove('show'); },

    setupColors() {
        const colors = ['#ffffff', '#000000', '#f24e1e', '#fbbc04', '#0d99ff', '#10b981', '#bb86fc'];
        const grid = document.getElementById('colorGrid');
        colors.forEach(c => {
            const swatch = document.createElement('div');
            swatch.className = 'color-swatch';
            swatch.style.background = c;
            swatch.onclick = () => {
                State.color = c;
                document.querySelectorAll('.color-swatch').forEach(s => s.style.border = 'none');
                swatch.style.border = '2px solid white';
            };
            grid.appendChild(swatch);
        });
    },

    setupSliders() {
        document.getElementById('penSize').oninput = e => {
            State.size = e.target.value;
            document.getElementById('sizeValue').innerText = e.target.value;
        };
        document.getElementById('penOpacity').oninput = e => {
            State.opacity = e.target.value;
            document.getElementById('opacityValue').innerText = Math.round(e.target.value * 100) + '%';
        };
    },

    createRoom() {
        const id = 'MR-' + Math.random().toString(36).substr(2, 4).toUpperCase();
        this.startSession(id);
    },

    joinRoom() {
        const id = document.getElementById('roomInput').value.trim();
        if (id) this.startSession(id);
    },

    startSession(id) {
        State.roomId = id;
        State.roomRef = db.ref('boards/' + id);
        document.getElementById('roomDisplay').innerText = id;
        document.getElementById('welcome-page').classList.add('hidden');
        document.getElementById('app-page').classList.remove('hidden');
        
        // Realtime Sinxronizatsiya
        State.roomRef.child('elements').on('value', s => {
            State.elements = s.exists() ? Object.values(s.val()) : [];
            Engine.renderReq();
        });

        State.roomRef.child('activePaths').on('value', s => {
            State.activePaths = s.exists() ? s.val() : {};
            Engine.renderReq();
        });
    },

    exit() { location.reload(); },
    
    copyRoomId() {
        navigator.clipboard.writeText(State.roomId);
        alert("Xona ID nusxalandi: " + State.roomId);
    }
};

// ILOVANI ISHGA TUSHIRISH
window.onload = () => UI.init();
