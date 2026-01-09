import * as THREE from 'three';
import { loadPlayer, updatePlayer, playerState, jump, shoot } from './player.js';
import { updateSmartCamera, camSettings, startCameraCinematic, startCameraReturn } from './camera.js';
import { loadLevel, levelState, spawnOrbsAtDoor, launchOrbs, updateOrbsLogic } from './level.js';

// --- CONFIGURACIÓN BÁSICA ---
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xeecfa1, 0.022);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping; 
renderer.toneMappingExposure = 0.5;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; 
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// --- LUCES Y SOL ---
const sunDistance = 50; 
const sunElevation = 13; 
const sunRotation = 270; 
let sunOffset = new THREE.Vector3();

const phi = THREE.MathUtils.degToRad(90 - sunElevation); 
const theta = THREE.MathUtils.degToRad(sunRotation);
sunOffset.set(
    sunDistance * Math.sin(phi) * Math.sin(theta), 
    sunDistance * Math.cos(phi), 
    sunDistance * Math.sin(phi) * Math.cos(theta)
);

const sunLight = new THREE.DirectionalLight(0xffeeb1, 6.0);
sunLight.castShadow = true; 
sunLight.shadow.mapSize.set(2048, 2048); 
sunLight.shadow.camera.left = -20; sunLight.shadow.camera.right = 20; sunLight.shadow.camera.top = 20; sunLight.shadow.camera.bottom = -20;
sunLight.shadow.camera.near = 0.5; sunLight.shadow.camera.far = 150;
sunLight.shadow.bias = -0.0005; 
sunLight.shadow.normalBias = 0.05; 

scene.add(sunLight); 
scene.add(sunLight.target); 
scene.add(new THREE.HemisphereLight(0xffd580, 0x222233, 0.5));

// --- ENTORNO ---
new THREE.TextureLoader().load('./assets/textures/bg_reflejosIBL.webp', (t) => { 
    t.mapping = THREE.EquirectangularReflectionMapping; 
    t.colorSpace = THREE.SRGBColorSpace; 
    scene.environment = t; 
    scene.environmentIntensity = 2.0; 
    if(scene.environmentRotation) scene.environmentRotation.y = THREE.MathUtils.degToRad(334); 
});

// -----------------------------------------------------------
// --- 4. INPUTS & JOYSTICK (FIX EVENTOS FANTASMA) ---
// -----------------------------------------------------------
let joystickVector = { x: 0, y: 0 }; 
let isDraggingJoystick = false;
let joystickTouchId = null; // Guardamos el ID del dedo

const joystickContainer = document.getElementById('joystick-container'); 
const joystickThumb = document.getElementById('joystick-thumb');

const handleJoystickMove = (e) => { 
    if (!isDraggingJoystick) return; 

    // Prevenir comportamientos por defecto
    if(e.cancelable && e.type.startsWith('touch')) e.preventDefault();
    if(e.stopPropagation) e.stopPropagation();

    const rect = joystickContainer.getBoundingClientRect(); 
    let clientX, clientY;

    // Buscar el dedo correcto
    if (e.touches) {
        let found = false;
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].identifier === joystickTouchId) {
                clientX = e.touches[i].clientX;
                clientY = e.touches[i].clientY;
                found = true;
                break;
            }
        }
        if (!found) return; 
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    let x = clientX - (rect.left + rect.width / 2); 
    let y = clientY - (rect.top + rect.height / 2); 
    let dist = Math.sqrt(x*x + y*y); 
    if (dist > 60) { x = (x / dist) * 60; y = (y / dist) * 60; } 
    joystickThumb.style.transform = `translate(${x}px, ${y}px)`; 
    joystickVector.x = x / 60; joystickVector.y = y / 60; 
};

const stopJoystick = (e) => {
    // PROTECCIÓN: Si estamos usando TOUCH, ignorar eventos de MOUSE (MouseUp fantasma)
    if (joystickTouchId !== null && joystickTouchId !== 'mouse' && !e.changedTouches) {
        return; 
    }

    // Si es touch, verificar que se levantó EL DEDO DEL JOYSTICK
    if (e.changedTouches) {
        let joystickEnded = false;
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === joystickTouchId) {
                joystickEnded = true;
                break;
            }
        }
        if (!joystickEnded) return; // Fue otro dedo (el de saltar), ignorar.
    }

    // Resetear todo
    isDraggingJoystick = false; 
    joystickTouchId = null;
    joystickVector = { x: 0, y: 0 }; 
    joystickThumb.style.transform = `translate(0px, 0px)`;
};

const startJoystick = (e) => {
    if(e.stopPropagation) e.stopPropagation();
    if(e.cancelable && e.type.startsWith('touch')) e.preventDefault();
    
    isDraggingJoystick = true; 
    
    if (e.changedTouches && e.changedTouches.length > 0) {
        joystickTouchId = e.changedTouches[0].identifier;
        handleJoystickMove(e); 
    } else {
        joystickTouchId = 'mouse';
        handleJoystickMove(e); 
    }
};

// Listeners
joystickContainer.addEventListener('touchstart', startJoystick, {passive: false});
joystickContainer.addEventListener('mousedown', startJoystick);

window.addEventListener('touchmove', handleJoystickMove, {passive: false});
window.addEventListener('mousemove', handleJoystickMove);

window.addEventListener('touchend', stopJoystick);
window.addEventListener('mouseup', stopJoystick);

// BOTONES DE ACCIÓN BLINDADOS
const bindAction = (id, action) => {
    const btn = document.getElementById(id);
    if(!btn) return;
    
    const trigger = (e) => { 
        // ¡CRUCIAL! Esto evita que el navegador genere un click/mouseup fantasma después
        if(e.cancelable) e.preventDefault(); 
        if(e.stopPropagation) e.stopPropagation(); 
        action(); 
    };

    // Escuchamos touchstart con passive: false para poder hacer preventDefault
    btn.addEventListener('touchstart', trigger, {passive: false});
    
    // Mousedown para PC (si es táctil, preventDefault arriba evitará que esto salte doble)
    btn.addEventListener('mousedown', trigger);
};

bindAction('btn-jump', jump);
bindAction('btn-shoot', () => shoot(scene));


// --- CARGA DE NIVEL Y JUGADOR ---
const loadingManager = new THREE.LoadingManager();
loadLevel(scene, loadingManager, './assets/models/MN_SCENE_01.gltf');
loadPlayer(scene, loadingManager);

// --- ESTADO DEL JUEGO ---
let questState = 0; 
let cinematicStartTime = 0;
let orbsLaunched = false;
const msgDisplay = document.getElementById('quest-message');
const raycaster = new THREE.Raycaster();

function checkPlatform() {
    if(!playerState.container || !levelState.platformMesh) return false;
    raycaster.set(playerState.container.position.clone().add(new THREE.Vector3(0,1,0)), new THREE.Vector3(0,-1,0));
    raycaster.far = 2.0;
    return raycaster.intersectObject(levelState.platformMesh, false).length > 0;
}

// --- BUCLE PRINCIPAL ---
const clock = new THREE.Clock();
const fpsDisplay = document.getElementById('fps-display');
let frames = 0, lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    const time = performance.now() / 1000;
    
    // FPS
    frames++; 
    if (performance.now() >= lastTime + 1000) { 
        if(fpsDisplay) fpsDisplay.innerText = "FPS: " + frames; 
        frames = 0; 
        lastTime = performance.now(); 
    }

    if (playerState.container) {
        sunLight.target.position.set(0, 0, playerState.container.position.z); 
        sunLight.target.updateMatrixWorld(); 
        sunLight.position.copy(sunLight.target.position).add(sunOffset);

        if (levelState.bgMesh) levelState.bgMesh.position.copy(camera.position);

        // --- MÁQUINA DE ESTADOS (MISIONES) ---
        if (questState === 0) {
            if (checkPlatform()) {
                questState = 1; 
                cinematicStartTime = time;
                orbsLaunched = false;
                if(msgDisplay) { msgDisplay.style.display = 'block'; setTimeout(() => msgDisplay.style.display = 'none', 5000); }
                spawnOrbsAtDoor(playerState.container.position);
                const d = new THREE.Vector3(); camera.getWorldDirection(d);
                startCameraCinematic(camera, camera.position.clone().add(d));
            }
        } 
        else if (questState === 1) {
            const cinTime = time - cinematicStartTime;
            if (cinTime > 5.0 && !orbsLaunched) { launchOrbs(camera.position, time); orbsLaunched = true; }
            if (cinTime > 6.5) { startCameraReturn(camera, playerState.container.position, levelState.doorsCenter); questState = 2; }
        }
        else if (questState === 2) {
            let collectedCount = 0;
            levelState.orbs.forEach((orb, i) => { 
                if(orb.collected) { 
                    collectedCount++; 
                    const target = (i===0 ? playerState.container.position : levelState.orbs[i-1].mesh.position).clone(); 
                    target.y += (i===0?1.8:0.4); 
                    orb.mesh.position.lerp(target, 5 * dt); 
                } 
            });

            if (collectedCount === 3 && checkPlatform()) {
                if (Math.abs(playerState.speed) < 0.1) { 
                    questState = 3;
                    levelState.doorActions.forEach(a => a.play());
                    if(msgDisplay) { msgDisplay.innerText = "PUERTA ABIERTA"; msgDisplay.style.display = 'block'; }
                } else {
                    if(msgDisplay) { msgDisplay.innerText = "QUIETO EN EL ALTAR"; msgDisplay.style.display = 'block'; }
                }
            } else if (collectedCount === 3) {
                 if(msgDisplay) { msgDisplay.innerText = "VUELVE AL ALTAR"; msgDisplay.style.display = 'block'; }
            } else {
                 if(msgDisplay) msgDisplay.style.display = 'none';
            }
        }

        const isCamActive = (questState === 1);
        updatePlayer(dt, camera, joystickVector, levelState.collisionMeshes, isCamActive);
        updateSmartCamera(camera, playerState.container, levelState.collisionMeshes, dt, levelState.doorsCenter);
        
        let cTime = 0; if(questState===1) cTime = time - cinematicStartTime;
        updateOrbsLogic(dt, time, playerState.container.position, camera.position, cTime);
    }

    if (levelState.sceneMixer) levelState.sceneMixer.update(dt);
    levelState.grassMaterialUniforms.time.value = clock.getElapsedTime();
    renderer.render(scene, camera);
}
animate();
window.addEventListener('resize', () => { camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });