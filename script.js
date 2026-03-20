/**
 * MR STUDIO ULTIMATE OS - ENTERPRISE v6 (CORE ENGINE)
 * Architecture: Modular Object-Oriented, Event-Driven
 * Features: Native 2D Canvas, WebRTC Mesh, Firebase Realtime Sync, Shape Previews.
 */

// ============================================================================
// 1. CONFIGURATION & GLOBAL STATE
// ============================================================================
const CONFIG = {
    firebase: { 
        apiKey: "AIzaSyDvbG7fChb2LN_nJhwTF1iMKMXNPcuGk5Y", 
        databaseURL: "https://tictactoe-26434-default-rtdb.firebaseio.com", 
        projectId: "tictactoe-26434" 
    },
    rtc: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
};

if (!firebase.apps.length) firebase.initializeApp(CONFIG.firebase);
const db = firebase.database();

const State = {
    user: { id: 'u_' + Math.random().toString(36).substr(2, 8), name: '', isTeacher: false, canDraw: false },
    room: { realId: '', shortCode: '', ref: null },
    
    // Canvas & Elements
    elements: {},       // Barcha chizmalar
    activePaths: {},    // Jonli chizilayotgan chiziqlar
    cursors: {},        // Boshqa foydalanuvchilar kursorlari
    
    // Engine Tools
    tool: 'draw', 
    color: '#0ea5e9', 
    size: 4,
    theme: document.documentElement.getAttribute('data-theme') || 'dark',
    
    // Viewport & Camera
    cam: { x: 0, y: 0, scale: 1 },
    
    // Interaction Flags
    isDrawing: false, 
    startPos: { x: 0, y: 0 }, 
    lastPos: { x: 0, y: 0 },
    previewShape: null, // Shakllar prevyusi uchun
    
    // Media State
    media: { cam: false, mic: false, screen: false }
};

// ============================================================================
// 2. UTILITY FUNCTIONS (Yordamchi Funksiyalar)
// ============================================================================
const Utils = {
    generateId: () => State.user.id + '_' + Date.now(),
    
    toast(msg, type = 'info') {
        const box = document.getElementById('toastContainer');
        if (!box) return;
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        const icons = { success: 'check-circle', danger: 'alert-triangle', info: 'info' };
        el.innerHTML = `<i data-lucide="${icons[type] || 'info'}" size="18"></i> <span>${msg}</span>`;
        box.appendChild(el);
        lucide.createIcons();
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(-20px)';
            setTimeout(() => el.remove(), 400);
        }, 3000);
    },

    getWorldPos(cx, cy) {
        return { x: (cx - State.cam.x) / State.cam.scale, y: (cy - State.cam.y) / State.cam.scale };
    },
    
    getScreenPos(wx, wy) {
        return { x: wx * State.cam.scale + State.cam.x, y: wy * State.cam.scale + State.cam.y };
    }
};

// ============================================================================
// 3. UI CONTROLLER (DOM va Voqealar boshqaruvi)
// ============================================================================
const UI = {
    init() {
        lucide.createIcons();
        
        // Asboblar paneli voqealari
        document.getElementById('sizeSlider').addEventListener('input', e => {
            State.size = parseInt(e.target.value);
            document.getElementById('strokeSizeDisplay').innerText = State.size;
        });

        // Theme Toggle
        document.getElementById('btnToggleTheme').addEventListener('click', () => this.toggleTheme());
        
        // Modallar va Menyularni yopish
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', e => document.getElementById(e.currentTarget.dataset.target).classList.add('hidden'));
        });

        // Chat Input
        const chatInput = document.getElementById('chatInput');
        chatInput.addEventListener('keypress', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendChat(); }
        });
        document.getElementById('btnSendChat').addEventListener('click', () => this.sendChat());

        // Panellar ochib/yopish (Chat, Users)
        document.querySelectorAll('.trigger-btn[data-panel]').forEach(btn => {
            btn.addEventListener('click', e => {
                const targetId = e.currentTarget.dataset.panel;
                const panel = document.getElementById(targetId);
                const isHidden = panel.classList.contains('hidden');
                
                // Boshqa panellarni yopish
                document.querySelectorAll('.side-panel').forEach(p => p.classList.add('hidden'));
                
                if (isHidden) {
                    panel.classList.remove('hidden');
                    if (targetId === 'chatPanel') document.getElementById('chatBadge').classList.add('hidden');
                }
            });
        });
        document.querySelectorAll('.close-panel').forEach(btn => {
            btn.addEventListener('click', e => document.getElementById(e.currentTarget.dataset.target).classList.add('hidden'));
        });
    },

    toggleTheme() {
        State.theme = State.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', State.theme);
        const icon = document.getElementById('themeIcon');
        icon.setAttribute('data-lucide', State.theme === 'dark' ? 'moon' : 'sun');
        lucide.createIcons();
    },

    updateRole() {
        document.getElementById('headerRoleText').innerText = State.user.isTeacher ? "Ustoz (Admin)" : (State.user.canDraw ? "Talaba (Ruxsatli)" : "Kuzatuvchi");
        document.getElementById('headerRoleIcon').setAttribute('data-lucide', State.user.isTeacher ? 'shield-check' : 'user');
        
        // Admin tugmalari
        document.getElementById('btnClearBoard').classList.toggle('hidden', !State.user.isTeacher);
        document.getElementById('toggleScreen').style.display = State.user.isTeacher ? 'flex' : 'none';
        document.getElementById('hostControls').classList.toggle('hidden', !State.user.isTeacher);
        
        // Asboblar panelini ko'rsatish/yashirish
        document.getElementById('mainToolbar').style.display = (State.user.isTeacher || State.user.canDraw) ? 'grid' : 'none';
        
        if (!State.user.isTeacher && !State.user.canDraw) CanvasEngine.setTool('pan');
        lucide.createIcons();
    },

    toggleMoreMenu() { document.getElementById('moreMenu').classList.toggle('show'); },

    sendChat() {
        const inp = document.getElementById('chatInput');
        const txt = inp.value.trim();
        if (!txt) return;
        State.room.ref.child('chat').push({ uid: State.user.id, name: State.user.name, text: txt, time: Date.now() });
        inp.value = '';
    },

    receiveChat(msg) {
        const container = document.getElementById('chatMessages');
        // Placeholder-ni o'chirish
        const ph = container.querySelector('.chat-placeholder');
        if (ph) ph.remove();

        const isMe = msg.uid === State.user.id;
        const timeStr = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const el = document.createElement('div');
        el.className = `chat-message ${isMe ? 'me' : 'other'}`;
        el.innerHTML = `
            ${!isMe ? `<span class="msg-sender">${msg.name}</span>` : ''}
            <div>${msg.text}</div>
            <span class="msg-time">${timeStr}</span>
        `;
        container.appendChild(el);
        container.scrollTop = container.scrollHeight;

        // Badge notification
        if (!isMe && document.getElementById('chatPanel').classList.contains('hidden')) {
            const badge = document.getElementById('chatBadge');
            badge.innerText = parseInt(badge.innerText || 0) + 1;
            badge.classList.remove('hidden');
            Utils.toast(`💬 ${msg.name}: ${msg.text.substring(0, 20)}...`);
        }
    },

    renderUsers(usersList) {
        const ul = document.getElementById('usersList');
        ul.innerHTML = '';
        let count = 0;

        Object.values(usersList).forEach(u => {
            if(u.isTeacher) return; // O'qituvchi ro'yxatda ko'rinmaydi
            count++;
            const li = document.createElement('li');
            li.className = 'user-item';
            
            let adminActions = '';
            if (State.user.isTeacher) {
                adminActions = `
                    <div class="user-permissions">
                        <button class="perm-btn ${u.canDraw ? 'granted' : 'denied'}" onclick="DB.updatePerm('${u.id}', 'canDraw', ${!u.canDraw})" title="Yozish ruxsati">
                            <i data-lucide="pen-tool"></i>
                        </button>
                        <button class="perm-btn denied" onclick="DB.kickUser('${u.id}', '${u.name}')" title="Darsdan chiqarish">
                            <i data-lucide="user-x"></i>
                        </button>
                    </div>`;
            }

            li.innerHTML = `
                <div class="user-info">
                    <div class="user-avatar">${u.name.charAt(0).toUpperCase()}</div>
                    <span class="user-name">${u.name}</span>
                </div>
                ${adminActions}
            `;
            ul.appendChild(li);
        });

        document.getElementById('userCount').innerText = count;
        document.getElementById('usersBadge').innerText = count;
        lucide.createIcons();
    }
};

// ============================================================================
// 4. CANVAS ENGINE (Native 2D, Bezier Curves, Fast Render)
// ============================================================================
const CanvasEngine = {
    el: document.getElementById('mainCanvas'),
    ctx: null,
    txtPos: null,

    init() {
        this.ctx = this.el.getContext('2d', { alpha: false, desynchronized: true });
        this.resize();
        window.addEventListener('resize', () => this.resize());

        // Pointer Events
        this.el.addEventListener('pointerdown', e => this.start(e));
        window.addEventListener('pointermove', e => this.move(e));
        window.addEventListener('pointerup', () => this.end());
        this.el.addEventListener('wheel', e => this.zoom(e), { passive: true });

        this.renderLoop();
    },

    resize() {
        this.el.width = window.innerWidth;
        this.el.height = window.innerHeight;
        this.updateStickyNotes();
    },

    setColor(c) {
        State.color = c;
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.color === c);
        });
    },

    setTool(t) {
        State.tool = t;
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === t));
        document.querySelectorAll('.sub-tool-btn').forEach(btn => {
            if (btn.dataset.tool === t) {
                document.getElementById('currentShapeIcon').setAttribute('data-lucide', btn.querySelector('i').getAttribute('data-lucide'));
                document.getElementById('btnShapes').classList.add('active');
            }
        });

        const topPanel = document.getElementById('propertiesPanel');
        if (['pan', 'text', 'sticky'].includes(t)) {
            topPanel.classList.add('hidden-tool');
        } else {
            topPanel.classList.remove('hidden-tool');
        }
        lucide.createIcons();
    },

    centerView() {
        State.cam = { x: 0, y: 0, scale: 1 };
        if (State.user.isTeacher) DB.syncCam();
        this.updateStickyNotes();
        UI.toggleMoreMenu();
    },

    downloadBoard() {
        const link = document.createElement('a');
        link.download = `MR_Doska_${Date.now()}.png`;
        link.href = this.el.toDataURL('image/png');
        link.click();
        UI.toggleMoreMenu();
        Utils.toast("Doska yuklab olindi", "success");
    },

    // --- Interactive Tools Logic ---
    startText(w) {
        const inp = document.getElementById('liveTextEditor');
        const s = Utils.getScreenPos(w.x, w.y);
        inp.style.left = s.x + 'px';
        inp.style.top = s.y + 'px';
        inp.style.fontSize = (24 * State.cam.scale) + 'px';
        inp.style.color = State.color;
        inp.style.display = 'block';
        inp.innerText = '';
        inp.focus();
        this.txtPos = { x: w.x, y: w.y };
    },

    saveText() {
        const inp = document.getElementById('liveTextEditor');
        const txt = inp.innerText.trim();
        if (txt && this.txtPos) {
            DB.saveElement({ type: 'text', txt, x: this.txtPos.x, y: this.txtPos.y, c: State.color, s: 24 });
        }
        inp.style.display = 'none';
        inp.innerText = '';
        this.txtPos = null;
    },

    createSticky(w) {
        const id = Utils.generateId();
        DB.saveElement({ type: 'sticky', id: id, txt: '', x: w.x, y: w.y, c: '#fef08a' });
    },

    start(e) {
        if (!State.user.canDraw && State.tool !== 'pan') return;
        if (e.target.isContentEditable) return;

        const w = Utils.getWorldPos(e.clientX, e.clientY);

        if (State.tool === 'text') return this.startText(w);
        if (State.tool === 'sticky') return this.createSticky(w);

        State.isDrawing = true;
        State.startPos = { x: w.x, y: w.y };
        State.lastPos = { x: e.clientX, y: e.clientY };

        if (State.tool !== 'pan') {
            this.activeId = Utils.generateId();
            
            // O'chirg'ich logikasi (Orqa fonga moslashish)
            const isErase = State.tool === 'erase';
            const color = isErase ? (State.theme === 'dark' ? '#0b1120' : '#f8fafc') : State.color;
            const size = isErase ? 60 : State.size;

            if (['draw', 'erase', 'highlighter'].includes(State.tool)) {
                const data = { type: State.tool, c: color, s: size, pts: [w] };
                if (State.tool === 'highlighter') { data.c = State.color + '66'; data.s = State.size * 3; } // Transparency
                DB.setActive(this.activeId, data);
            }
        }
    },

    move(e) {
        if (!State.isDrawing) return;
        const cx = e.clientX, cy = e.clientY;
        const w = Utils.getWorldPos(cx, cy);

        // Sinxronizatsiyani optimallashtirish
        if (Date.now() % 4 === 0) DB.updateCursor(w);

        if (State.tool === 'pan') {
            State.cam.x += cx - State.lastPos.x;
            State.cam.y += cy - State.lastPos.y;
            this.updateStickyNotes();
            if (State.user.isTeacher) DB.syncCam();
        } 
        else if (['draw', 'erase', 'highlighter'].includes(State.tool)) {
            // Chiziq tortish
            const active = State.activePaths[this.activeId];
            if (active && active.pts) {
                const last = active.pts[active.pts.length - 1];
                if (Math.hypot(w.x - last.x, w.y - last.y) > 2) { // 2px siljigandagina bazaga yozish
                    State.room.ref.child('active/' + this.activeId + '/pts').push(w);
                }
            }
        } 
        else if (['rect', 'circle', 'triangle', 'line', 'arrow'].includes(State.tool)) {
            // Shakllar Prevyusi (Baza yozilmaydi, faqat mahalliy state o'zgaradi)
            State.previewShape = { type: State.tool, c: State.color, s: State.size, x: State.startPos.x, y: State.startPos.y, ex: w.x, ey: w.y };
        }
        
        State.lastPos = { x: cx, y: cy };
    },

    end() {
        if (!State.isDrawing) return;
        State.isDrawing = false;

        if (['rect', 'circle', 'triangle', 'line', 'arrow'].includes(State.tool) && State.previewShape) {
            // Shaklni yakunlab bazaga saqlash
            DB.saveElement(State.previewShape);
            State.previewShape = null;
        } 
        else if (['draw', 'erase', 'highlighter'].includes(State.tool) && this.activeId) {
            // Chiziqni doimiy bazaga o'tkazish
            State.room.ref.child('active/' + this.activeId).once('value', s => {
                if (s.exists()) { DB.saveElement(s.val()); s.ref.remove(); }
            });
            this.activeId = null;
        }
    },

    zoom(e) {
        if (!State.user.isTeacher && !State.user.canDraw) return;
        const w = Utils.getWorldPos(e.clientX, e.clientY);
        
        State.cam.scale *= e.deltaY > 0 ? 0.9 : 1.1;
        State.cam.scale = Math.max(0.1, Math.min(State.cam.scale, 5));
        
        State.cam.x = e.clientX - w.x * State.cam.scale;
        State.cam.y = e.clientY - w.y * State.cam.scale;
        
        this.updateStickyNotes();
        document.getElementById('zoomLevelDisplay').innerText = Math.round(State.cam.scale * 100) + '%';
        if (State.user.isTeacher) DB.syncCam();
    },

    // --- Core Render Loop ---
    renderLoop() {
        const ctx = this.ctx;
        
        // 1. Fon va Tozalash
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = State.theme === 'dark' ? '#0b1120' : '#f8fafc';
        ctx.fillRect(0, 0, this.el.width, this.el.height);
        
        // 2. Grid Chizish (Agar yoqilgan bo'lsa)
        if (document.getElementById('toggleGrid')?.checked) {
            ctx.fillStyle = State.theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)';
            const gs = 40 * State.cam.scale;
            const ox = State.cam.x % gs, oy = State.cam.y % gs;
            ctx.beginPath();
            for (let x = ox; x < this.el.width; x += gs) { for (let y = oy; y < this.el.height; y += gs) ctx.rect(x, y, 2, 2); }
            ctx.fill();
        }

        // 3. Kamera transformatsiyasi
        ctx.setTransform(State.cam.scale, 0, 0, State.cam.scale, State.cam.x, State.cam.y);

        // Shakl chizuvchi yordamchi funksiya
        const drawShape = (el) => {
            if (!el || el.type === 'sticky') return;
            
            ctx.beginPath();
            ctx.strokeStyle = el.c;
            ctx.fillStyle = el.c;
            ctx.lineWidth = el.s / State.cam.scale; // Zoom bo'lganda qalinlik o'zgarmasligi uchun
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            // Quadratic Bezier Smoothing (Silliq chiziq)
            if (['draw', 'erase', 'highlighter'].includes(el.type) && el.pts && el.pts.length > 0) {
                ctx.moveTo(el.pts[0].x, el.pts[0].y);
                if (el.pts.length < 3) {
                    for (let i = 1; i < el.pts.length; i++) ctx.lineTo(el.pts[i].x, el.pts[i].y);
                } else {
                    for (let i = 1; i < el.pts.length - 2; i++) {
                        const xc = (el.pts[i].x + el.pts[i + 1].x) / 2;
                        const yc = (el.pts[i].y + el.pts[i + 1].y) / 2;
                        ctx.quadraticCurveTo(el.pts[i].x, el.pts[i].y, xc, yc);
                    }
                    const last = el.pts.length - 1;
                    ctx.quadraticCurveTo(el.pts[last - 1].x, el.pts[last - 1].y, el.pts[last].x, el.pts[last].y);
                }
                ctx.stroke();
            } 
            else if (el.type === 'rect') { ctx.strokeRect(el.x, el.y, el.ex - el.x, el.ey - el.y); }
            else if (el.type === 'circle') {
                const rx = Math.abs(el.ex - el.x) / 2, ry = Math.abs(el.ey - el.y) / 2;
                ctx.ellipse(el.x + rx * (el.ex < el.x ? -1 : 1), el.y + ry * (el.ey < el.y ? -1 : 1), rx, ry, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
            else if (el.type === 'triangle') {
                ctx.moveTo(el.x + (el.ex - el.x) / 2, el.y);
                ctx.lineTo(el.ex, el.ey);
                ctx.lineTo(el.x, el.ey);
                ctx.closePath();
                ctx.stroke();
            }
            else if (el.type === 'line') { ctx.moveTo(el.x, el.y); ctx.lineTo(el.ex, el.ey); ctx.stroke(); }
            else if (el.type === 'arrow') {
                ctx.moveTo(el.x, el.y); ctx.lineTo(el.ex, el.ey);
                const angle = Math.atan2(el.ey - el.y, el.ex - el.x);
                const headlen = 20 / State.cam.scale;
                ctx.lineTo(el.ex - headlen * Math.cos(angle - Math.PI / 6), el.ey - headlen * Math.sin(angle - Math.PI / 6));
                ctx.moveTo(el.ex, el.ey);
                ctx.lineTo(el.ex - headlen * Math.cos(angle + Math.PI / 6), el.ey - headlen * Math.sin(angle + Math.PI / 6));
                ctx.stroke();
            }
            else if (el.type === 'text') {
                ctx.font = `600 ${el.s}px Inter`;
                ctx.fillText(el.txt, el.x, el.y);
            }
        };

        // 4. Barcha obyektlarni chizish
        Object.values(State.elements).forEach(drawShape);
        Object.values(State.activePaths).forEach(drawShape);
        if (State.previewShape) drawShape(State.previewShape); // Prevyu

        // 5. Kursorlarni chizish (Global matrixda emas, Screen matrixda)
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        Object.values(State.cursors).forEach(c => {
            if (c.id === State.user.id || !c.x) return;
            const px = c.x * State.cam.scale + State.cam.x;
            const py = c.y * State.cam.scale + State.cam.y;
            
            ctx.beginPath();
            ctx.moveTo(px, py); ctx.lineTo(px + 14, py + 14); ctx.lineTo(px + 5, py + 14); ctx.lineTo(px, py + 20); ctx.closePath();
            ctx.fillStyle = c.isT ? '#0ea5e9' : '#ef4444'; ctx.fill();
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
            
            ctx.font = '600 11px Inter'; ctx.fillStyle = State.theme === 'dark' ? '#fff' : '#000';
            ctx.fillText(c.n, px + 16, py + 16);
        });

        requestAnimationFrame(() => this.renderLoop());
    },

    // --- DOM Elements (Sticky Notes) ---
    renderStickyNotes() {
        const container = document.getElementById('stickyNotesContainer');
        container.innerHTML = '';
        
        Object.values(State.elements).forEach(el => {
            if (el.type !== 'sticky') return;
            
            const div = document.createElement('textarea');
            div.className = 'sticky-note';
            div.value = el.txt;
            div.style.backgroundColor = el.c;
            
            div.addEventListener('input', e => {
                State.room.ref.child('els/' + el.fbKey).update({ txt: e.target.value });
            });

            // Pozitsiyani moslashtirish
            div.dataset.wx = el.x; div.dataset.wy = el.y; div.dataset.fbKey = el.fbKey;
            
            container.appendChild(div);
        });
        this.updateStickyNotes();
    },

    updateStickyNotes() {
        const container = document.getElementById('stickyNotesContainer');
        if (!container) return;
        Array.from(container.children).forEach(note => {
            const wx = parseFloat(note.dataset.wx);
            const wy = parseFloat(note.dataset.wy);
            const s = Utils.getScreenPos(wx, wy);
            
            note.style.left = s.x + 'px';
            note.style.top = s.y + 'px';
            note.style.transform = `scale(${State.cam.scale})`;
            note.style.pointerEvents = State.user.canDraw ? 'auto' : 'none';
        });
    }
};

// ============================================================================
// 5. WEBRTC MEDIA ENGINE (Video, Audio, Screen Share)
// ============================================================================
const MediaEngine = {
    stream: null,
    screenStream: null,
    peers: {},

    init() {
        document.getElementById('toggleCam').addEventListener('click', () => this.toggleCam());
        document.getElementById('toggleMic').addEventListener('click', () => this.toggleMic());
        document.getElementById('toggleScreen').addEventListener('click', () => this.toggleScreen());
    },

    async toggleCam() {
        State.media.cam = !State.media.cam;
        const btn = document.getElementById('toggleCam');
        const icon = btn.querySelector('i');
        
        if (State.media.cam) {
            btn.classList.add('active'); icon.setAttribute('data-lucide', 'video');
            await this.start();
        } else {
            btn.classList.remove('active'); icon.setAttribute('data-lucide', 'video-off');
            if (this.stream) this.stream.getVideoTracks().forEach(t => t.enabled = false);
            document.getElementById('localVideoCard').classList.add('hidden');
        }
        lucide.createIcons();
    },

    async toggleMic() {
        State.media.mic = !State.media.mic;
        const btn = document.getElementById('toggleMic');
        const icon = btn.querySelector('i');
        
        if (State.media.mic) {
            btn.classList.add('active'); icon.setAttribute('data-lucide', 'mic');
            await this.start();
        } else {
            btn.classList.remove('active'); icon.setAttribute('data-lucide', 'mic-off');
            if (this.stream) this.stream.getAudioTracks().forEach(t => t.enabled = false);
        }
        lucide.createIcons();
    },

    async toggleScreen() {
        if (!this.screenStream) {
            try {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                document.getElementById('toggleScreen').classList.add('active');
                
                Object.values(this.peers).forEach(pc => {
                    this.screenStream.getTracks().forEach(t => pc.addTrack(t, this.screenStream));
                });

                this.screenStream.getVideoTracks()[0].onended = () => this.toggleScreen();
                Utils.toast("Ekran ulashildi", "success");
            } catch(e) { Utils.toast("Ekran ulashish bekor qilindi.", "info"); }
        } else {
            this.screenStream.getTracks().forEach(t => t.stop());
            this.screenStream = null;
            document.getElementById('toggleScreen').classList.remove('active');
        }
    },

    async start() {
        if (!this.stream) {
            try {
                this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                document.getElementById('localVideo').srcObject = this.stream;
                this.listenSignaling();
                this.analyzeAudio(this.stream, 'localAudioIndicator');
            } catch(e) {
                Utils.toast("Kamera yoki Mikrofonga ruxsat yo'q!", "danger");
                State.media.cam = false; State.media.mic = false;
                return;
            }
        }
        
        this.stream.getVideoTracks()[0].enabled = State.media.cam;
        this.stream.getAudioTracks()[0].enabled = State.media.mic;
        
        if (State.media.cam) document.getElementById('localVideoCard').classList.remove('hidden');
    },

    analyzeAudio(stream, dotId) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const analyser = ctx.createAnalyser();
            const src = ctx.createMediaStreamSource(stream);
            src.connect(analyser);
            analyser.fftSize = 256;
            const data = new Uint8Array(analyser.frequencyBinCount);
            
            const check = () => {
                requestAnimationFrame(check);
                analyser.getByteFrequencyData(data);
                const avg = data.reduce((a,b) => a+b) / data.length;
                const dot = document.getElementById(dotId);
                if (dot) {
                    dot.classList.toggle('speaking', avg > 10);
                }
            };
            check();
        } catch(e) {}
    },

    listenSignaling() {
        State.room.ref.child('sig/' + State.user.id).on('child_added', async snap => {
            const data = snap.val(); snap.ref.remove();
            if (data.type === 'offer') await this.handleOffer(data.from, data.sdp);
            else if (data.type === 'answer') await this.handleAnswer(data.from, data.sdp);
            else if (data.type === 'ice') await this.handleIce(data.from, data.ice);
        });

        State.room.ref.child('users').on('child_added', snap => {
            if (snap.key !== State.user.id) setTimeout(() => this.call(snap.key), 1000);
        });
    },

    createPeer(id) {
        const pc = new RTCPeerConnection(CONFIG.rtc);
        
        if (this.stream) this.stream.getTracks().forEach(t => pc.addTrack(t, this.stream));
        if (this.screenStream) this.screenStream.getTracks().forEach(t => pc.addTrack(t, this.screenStream));

        pc.onicecandidate = e => {
            if (e.candidate) State.room.ref.child('sig/' + id).push({ type: 'ice', ice: JSON.stringify(e.candidate), from: State.user.id });
        };

        pc.ontrack = e => {
            if (e.track.kind === 'video') {
                let card = document.getElementById('vc_' + id);
                if (!card) {
                    card = document.createElement('div');
                    card.className = 'vid-card smooth-enter';
                    card.id = 'vc_' + id;
                    card.innerHTML = `
                        <video id="v_${id}" autoplay playsinline></video>
                        <div class="vid-label"><div class="audio-dot" id="ad_${id}"></div> Foydalanuvchi</div>`;
                    document.getElementById('videoGridContainer').appendChild(card);
                }
                document.getElementById('v_' + id).srcObject = e.streams[0];
            } else {
                let audio = document.getElementById('au_' + id);
                if (!audio) {
                    audio = document.createElement('audio');
                    audio.id = 'au_' + id;
                    audio.autoplay = true;
                    document.getElementById('audioContainer').appendChild(audio);
                }
                audio.srcObject = e.streams[0];
                this.analyzeAudio(e.streams[0], 'ad_' + id);
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                document.getElementById('vc_' + id)?.remove();
                delete this.peers[id];
            }
        };

        pc.onnegotiationneeded = async () => {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            State.room.ref.child('sig/' + id).push({ type: 'offer', sdp: JSON.stringify(offer), from: State.user.id });
        };

        this.peers[id] = pc;
        return pc;
    },

    async call(id) { if (!this.peers[id]) this.createPeer(id); },
    
    async handleOffer(id, sdp) {
        const pc = this.peers[id] || this.createPeer(id);
        await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(sdp)));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        State.room.ref.child('sig/' + id).push({ type: 'answer', sdp: JSON.stringify(answer), from: State.user.id });
    },
    
    async handleAnswer(id, sdp) { await this.peers[id]?.setRemoteDescription(new RTCSessionDescription(JSON.parse(sdp))); },
    async handleIce(id, ice) { await this.peers[id]?.addIceCandidate(new RTCIceCandidate(JSON.parse(ice))); }
};

// ============================================================================
// 6. DATABASE SYNC ENGINE (Firebase)
// ============================================================================
const DB = {
    init(realId) {
        State.room.realId = realId;
        State.room.ref = db.ref('mr_os_v6/' + realId);
        
        // Transition UI
        document.getElementById('authScreen').classList.replace('active', 'hidden');
        document.getElementById('workspaceScreen').classList.replace('hidden', 'active');
        
        document.getElementById('displayRoomCode').innerText = State.room.shortCode || realId.substring(0,6);
        UI.updateRole();
        
        // Register User
        const myRef = State.room.ref.child('users/' + State.user.id);
        myRef.set({ id: State.user.id, name: State.user.name, isTeacher: State.user.isTeacher, canDraw: State.user.canDraw });
        myRef.onDisconnect().remove();
        State.room.ref.child('prs/' + State.user.id).onDisconnect().remove();

        this.listen();
        CanvasEngine.init();
        MediaEngine.init();
        UI.init();
    },

    listen() {
        // Elements Sync
        State.room.ref.child('els').on('value', snap => {
            const data = snap.val() || {};
            // Format into array with fbKey for updating (e.g., sticky notes)
            State.elements = Object.entries(data).reduce((acc, [key, val]) => {
                acc[key] = { ...val, fbKey: key };
                return acc;
            }, {});
            CanvasEngine.renderStickyNotes();
        });

        // Active Drawing Sync
        State.room.ref.child('active').on('value', snap => { State.activePaths = snap.val() || {}; });
        
        // Cursors Sync
        State.room.ref.child('prs').on('value', snap => { State.cursors = snap.val() || {}; });

        // Chat Sync
        State.room.ref.child('chat').on('child_added', snap => { UI.receiveChat(snap.val()); });

        // Users & Permissions Sync
        State.room.ref.child('users').on('value', snap => {
            const users = snap.val() || {};
            const me = users[State.user.id];
            
            if (me && !State.user.isTeacher) {
                if (State.user.canDraw !== me.canDraw) {
                    State.user.canDraw = me.canDraw;
                    UI.updateRole();
                    Utils.toast(me.canDraw ? "Yozish ruxsati berildi!" : "Yozish ruxsati olindi", me.canDraw ? 'success' : 'danger');
                    CanvasEngine.updateStickyNotes();
                }
            } else if (!me && !State.user.isTeacher) {
                alert("Darsdan chetlashtirildingiz.");
                location.reload();
            }
            UI.renderUsers(users);
        });

        // Camera Sync (Force view for non-drawers)
        if (!State.user.isTeacher) {
            State.room.ref.child('cam').on('value', snap => {
                if (!State.user.canDraw && snap.val()) {
                    State.cam = snap.val();
                    CanvasEngine.updateStickyNotes();
                }
            });
        }
    },

    saveElement(el) { State.room.ref.child('els').push(el); },
    setActive(id, data) { State.activePaths[id] = data; State.room.ref.child('active/' + id).set(data); },
    updateCursor(p) { State.room.ref.child('prs/' + State.user.id).set({ id: State.user.id, x: p.x, y: p.y, n: State.user.name, isT: State.user.isTeacher }); },
    syncCam() { State.room.ref.child('cam').set(State.cam); },
    
    updatePerm(uid, type, val) { State.room.ref.child(`users/${uid}/${type}`).set(val); },
    kickUser(uid, name) { if(confirm(`${name} darsdan chiqarilsinmi?`)) State.room.ref.child(`users/${uid}`).remove(); },
    
    undo() {
        State.room.ref.child('els').orderByKey().limitToLast(1).once('value', snap => {
            snap.forEach(child => child.ref.remove());
        });
    },
    
    clearBoard() {
        if (confirm("Butunlay tozalansinmi?")) {
            State.room.ref.child('els').remove();
            document.getElementById('moreMenu').classList.remove('show');
            Utils.toast("Doska tozalandi", "info");
        }
    }
};

// ============================================================================
// 7. APP BOOTSTRAP & ROUTING
// ============================================================================
const App = {
    init() {
        const urlParams = new URLSearchParams(window.location.search);
        const adminId = urlParams.get('admin');
        
        if (adminId) {
            document.getElementById('btnJoinRoom').parentElement.classList.add('hidden');
            document.querySelector('.auth-divider').classList.add('hidden');
            this.pendingRoomId = adminId;
        }
    },

    async createRoom() {
        const name = document.getElementById('userName').value.trim();
        if (!name) return Utils.toast("Ismingizni kiriting!", "danger");

        State.user.name = name;
        State.user.isTeacher = true;
        State.user.canDraw = true;

        let realId, shortCode;

        if (this.pendingRoomId) {
            realId = this.pendingRoomId;
            shortCode = "Admin";
        } else {
            realId = 'mr_admin_' + Date.now().toString(36);
            shortCode = 'MR-' + Math.floor(1000 + Math.random() * 9000);
            await db.ref('mr_alias/' + shortCode).set({ realId });
            window.history.pushState({}, '', '?admin=' + realId);
        }

        State.room.shortCode = shortCode;
        DB.init(realId);
        Utils.toast("Dars yaratildi!", "success");
    },

    async joinRoom() {
        const code = document.getElementById('roomCode').value.trim().toUpperCase();
        const name = document.getElementById('userName').value.trim();
        
        if (!name) return Utils.toast("Ismingizni kiriting!", "danger");
        if (!code) return Utils.toast("Kodni kiriting!", "danger");

        try {
            const snap = await db.ref('mr_alias/' + code).once('value');
            if (snap.exists()) {
                State.user.name = name;
                State.user.isTeacher = false;
                State.room.shortCode = code;
                DB.init(snap.val().realId);
                Utils.toast("Darsga ulandingiz!", "success");
            } else {
                Utils.toast("KOD xato yoki dars tugagan!", "danger");
            }
        } catch (e) {
            Utils.toast("Tarmoq xatosi!", "danger");
        }
    },
    
    copyStudentCode() {
        navigator.clipboard.writeText(State.room.shortCode);
        Utils.toast(`Kod nusxalandi: ${State.room.shortCode}`, "success");
    }
};

// Event Listeners for Auth
document.getElementById('btnCreateRoom').addEventListener('click', () => App.createRoom());
document.getElementById('btnJoinRoom').addEventListener('click', () => App.joinRoom());

// Start
App.init();
