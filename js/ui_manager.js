export const inputState = {
    joystickVector: { x: 0, y: 0 },
    isDraggingJoystick: false
};

export function initUI(callbacks) {
    const { onJump, onShoot, onGrassChange } = callbacks;

    // --- ERROR LOGGING ---
    window.addEventListener('error', (e) => {
        const el = document.getElementById('error-log');
        if(el) { el.style.display = 'block'; el.innerHTML += "Error: " + e.message + "<br>"; }
    });

    // --- JOYSTICK LOGIC ---
    let joystickTouchId = null;
    const joystickContainer = document.getElementById('joystick-container');
    const joystickThumb = document.getElementById('joystick-thumb');

    const handleJoystickMove = (e) => {
        if (!inputState.isDraggingJoystick) return;
        if(e.cancelable && e.type.startsWith('touch')) e.preventDefault();
        
        const rect = joystickContainer.getBoundingClientRect();
        let clientX, clientY;
        
        if (e.touches) {
            let found = false;
            for (let i = 0; i < e.touches.length; i++) {
                if (e.touches[i].identifier === joystickTouchId) {
                    clientX = e.touches[i].clientX;
                    clientY = e.touches[i].clientY;
                    found = true; break;
                }
            }
            if (!found) return;
        } else {
            clientX = e.clientX; clientY = e.clientY;
        }

        let x = clientX - (rect.left + rect.width / 2);
        let y = clientY - (rect.top + rect.height / 2);
        let dist = Math.sqrt(x*x + y*y);
        const maxDist = 60;
        
        if (dist > maxDist) { x = (x / dist) * maxDist; y = (y / dist) * maxDist; }
        
        joystickThumb.style.transform = `translate(${x}px, ${y}px)`;
        inputState.joystickVector.x = x / maxDist;
        inputState.joystickVector.y = y / maxDist;
    };

    const stopJoystick = (e) => {
        if (e.changedTouches) {
            let joystickEnded = false;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === joystickTouchId) { joystickEnded = true; break; }
            }
            if (!joystickEnded) return;
        }
        inputState.isDraggingJoystick = false;
        joystickTouchId = null;
        inputState.joystickVector = { x: 0, y: 0 };
        joystickThumb.style.transform = `translate(0px, 0px)`;
    };

    const startJoystick = (e) => {
        if(e.stopPropagation) e.stopPropagation();
        if(e.cancelable && e.type.startsWith('touch')) e.preventDefault();
        inputState.isDraggingJoystick = true;
        if (e.changedTouches && e.changedTouches.length > 0) {
            joystickTouchId = e.changedTouches[0].identifier;
            handleJoystickMove(e);
        } else {
            joystickTouchId = 'mouse';
            handleJoystickMove(e);
        }
    };

    if(joystickContainer) {
        joystickContainer.addEventListener('touchstart', startJoystick, {passive: false});
        joystickContainer.addEventListener('mousedown', startJoystick);
        window.addEventListener('touchmove', handleJoystickMove, {passive: false});
        window.addEventListener('mousemove', handleJoystickMove);
        window.addEventListener('touchend', stopJoystick);
        window.addEventListener('mouseup', stopJoystick);
    }

    // --- ACTION BUTTONS ---
    const bindAction = (id, action) => {
        const btn = document.getElementById(id);
        if(!btn) return;
        const trigger = (e) => { 
            if(e.cancelable) e.preventDefault(); 
            e.stopPropagation(); 
            action(); 
        };
        btn.addEventListener('touchstart', trigger, {passive: false});
        btn.addEventListener('mousedown', trigger);
    };
    bindAction('btn-jump', onJump);
    bindAction('btn-shoot', onShoot);

    // --- SLIDER HIERBA ---
    const grassSlider = document.getElementById('grass-slider');
    const grassLabel = document.getElementById('grass-val');
    if (grassSlider) {
        grassSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            if (grassLabel) grassLabel.innerText = val;
            onGrassChange(val);
        });
    }

    // --- PARTICLE MENU LOGIC ---
    const menu = document.getElementById('particle-menu');
    const btnOpen = document.getElementById('btn-open-particles');
    const btnClose = document.getElementById('btn-close-particles');
    const presetList = document.getElementById('preset-list');
    const uploadInput = document.getElementById('particle-upload');

    const toggleMenu = () => {
        const isHidden = menu.style.display === 'none' || menu.style.display === '';
        menu.style.display = isHidden ? 'flex' : 'none';
        btnOpen.style.display = isHidden ? 'none' : 'block';
        if(isHidden) loadPresets();
    };

    const loadPresets = () => {
        presetList.innerHTML = '';
        let found = false;
        for(let i=0; i<localStorage.length; i++) {
            const k = localStorage.key(i);
            if(k.startsWith('preset_')) {
                const name = k.replace('preset_', '');
                const div = document.createElement('div');
                div.className = 'preset-item';
                div.innerText = name;
                div.onclick = () => {
                    try {
                        const data = JSON.parse(localStorage.getItem(k));
                        window.dispatchEvent(new CustomEvent('loadParticles', { detail: data.layers || data }));
                        toggleMenu();
                    } catch(e) { console.error(e); }
                };
                presetList.appendChild(div);
                found = true;
            }
        }
        if(!found) presetList.innerHTML = '<div style="font-size:10px; color:#666; font-style:italic">Sin presets guardados.</div>';
    };

    if(btnOpen) btnOpen.onclick = toggleMenu;
    if(btnClose) btnClose.onclick = toggleMenu;

    if(uploadInput) {
        uploadInput.addEventListener('change', (e) => {
            const f = e.target.files[0];
            if(!f) return;
            const r = new FileReader();
            r.onload = (evt) => {
                try {
                    const data = JSON.parse(evt.target.result);
                    window.dispatchEvent(new CustomEvent('loadParticles', { detail: data.layers || data }));
                    toggleMenu();
                } catch(err) { alert("JSON Inválido"); }
            };
            r.readAsText(f);
        });
    }
}

export const fpsDisplay = document.getElementById('fps-display');
export const msgDisplay = document.getElementById('quest-message');