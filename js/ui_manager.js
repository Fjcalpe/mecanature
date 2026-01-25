export const inputState = {
    joystickVector: { x: 0, y: 0 },
    isDraggingJoystick: false
};

// Nueva función para gestionar botones in-game
export function initQualityHUD(onQualitySelected) {
    const btns = {
        high: document.getElementById('btn-q-high'),
        medium: document.getElementById('btn-q-med'),
        low: document.getElementById('btn-q-low')
    };

    if(!btns.high) return;

    const setActive = (selectedKey) => {
        Object.keys(btns).forEach(k => {
            if(k === selectedKey) btns[k].classList.add('active');
            else btns[k].classList.remove('active');
        });
        onQualitySelected(selectedKey);
    };

    // Usamos touchstart y mousedown para respuesta rápida
    const bind = (key) => {
        const fn = (e) => { 
            e.preventDefault(); e.stopPropagation(); 
            setActive(key); 
        };
        btns[key].addEventListener('touchstart', fn, {passive: false});
        btns[key].addEventListener('mousedown', fn);
    };

    bind('high');
    bind('medium');
    bind('low');
}

export function initUI(callbacks) {
    const { onJump, onShoot } = callbacks;

    window.addEventListener('error', (e) => {
        const el = document.getElementById('error-log');
        if(el) { el.style.display = 'block'; el.innerHTML += "Error: " + e.message + "<br>"; }
    });

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

    const bindAction = (id, action) => {
        const btn = document.getElementById(id);
        if(!btn) return;
        const trigger = (e) => { if(e.cancelable) e.preventDefault(); e.stopPropagation(); action(); };
        btn.addEventListener('touchstart', trigger, {passive: false});
        btn.addEventListener('mousedown', trigger);
    };
    bindAction('btn-jump', onJump);
    bindAction('btn-shoot', onShoot);
}

export const fpsDisplay = document.getElementById('fps-display');
export const msgDisplay = document.getElementById('quest-message');