import * as THREE from 'three';
import { loadPlayer, updatePlayer, playerState, jump, shoot, unlockPlayerAudio } from './player.js'; 
import { updateSmartCamera, camSettings, startCameraCinematic, startCameraReturn } from './camera.js';
import { loadLevel, levelState, spawnOrbsAtDoor, launchOrbs, updateOrbsLogic, generateInstancedGrass, updateAllOrbParticles, unlockLevelAudio, playOrbAppearSound, startOrbMelodies } from './level.js'; 
import { InGameEditor } from './editor_ui.js'; 
import { initUI, inputState, fpsDisplay, msgDisplay, initQualityHUD } from './ui_manager.js';

// --- CONFIGURACIÓN ESCENA ---
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xeecfa1, 0.022);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
// Pixel ratio inicial (default ALTA)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping; 
renderer.toneMappingExposure = 0.5;
renderer.outputColorSpace = THREE.SRGBColorSpace; 
renderer.shadowMap.enabled = true; 
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// --- ILUMINACIÓN ---
const sunDistance = 50; const sunElevation = 13; const sunRotation = 270; 
let sunOffset = new THREE.Vector3();
const phi = THREE.MathUtils.degToRad(90 - sunElevation); 
const theta = THREE.MathUtils.degToRad(sunRotation);
sunOffset.set(sunDistance * Math.sin(phi) * Math.sin(theta), sunDistance * Math.cos(phi), sunDistance * Math.sin(phi) * Math.cos(theta));

const sunLight = new THREE.DirectionalLight(0xffeeb1, 6.0);
sunLight.castShadow = true; 
sunLight.shadow.mapSize.set(2048, 2048); 
sunLight.shadow.camera.left = -20; sunLight.shadow.camera.right = 20; 
sunLight.shadow.camera.top = 20; sunLight.shadow.camera.bottom = -20;
sunLight.shadow.camera.near = 0.5; sunLight.shadow.camera.far = 150;
sunLight.shadow.bias = -0.0005; sunLight.shadow.normalBias = 0.05; 
scene.add(sunLight); scene.add(sunLight.target); 
scene.add(new THREE.HemisphereLight(0xffd580, 0x222233, 0.5));

new THREE.TextureLoader().load('./assets/textures/bg_reflejosIBL.webp', (t) => { 
    t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; 
    scene.environment = t; scene.environmentIntensity = 2.0; 
    if(scene.environmentRotation) scene.environmentRotation.y = THREE.MathUtils.degToRad(334); 
});

// --- FUNCIÓN DE CALIDAD GRÁFICA ---
function applyGraphicsSettings(quality) {
    console.log("Cambiando calidad a:", quality);
    
    if (quality === 'high') {
        // ALTA: Todo original
        levelState.grassParams.count = 2000;
        sunLight.shadow.mapSize.set(2048, 2048);
        renderer.shadowMap.enabled = true;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    } else if (quality === 'medium') {
        // MEDIA: 1000 hierbas, sombras 1024, pixel 1x
        levelState.grassParams.count = 1000;
        sunLight.shadow.mapSize.set(1024, 1024);
        renderer.shadowMap.enabled = true;
        renderer.setPixelRatio(1.0);
    } else if (quality === 'low') {
        // BAJA: 500 hierbas, sin sombras, pixel 0.8x
        levelState.grassParams.count = 500;
        renderer.shadowMap.enabled = false;
        renderer.setPixelRatio(0.8);
    }

    // Actualizar sombra si cambió el tamaño del mapa
    if(sunLight.shadow.map) {
        sunLight.shadow.map.dispose();
        sunLight.shadow.map = null;
    }
    
    // Regenerar hierba dinámicamente
    generateInstancedGrass(scene);
}

// Inicializamos el HUD y activamos calidad Alta por defecto
initQualityHUD(applyGraphicsSettings);
// Forzamos la actualización visual y lógica al inicio
// Nota: applyGraphicsSettings ya se ejecutó implícitamente por el renderer, pero esto sincroniza el botón activo si hiciera falta lógica extra.
// (El botón "ALTA" ya tiene la clase .active en el HTML por defecto)

// --- AUDIO AMBIENTE (Tone.Player) ---
let audioAmbient = null;
let audioUnlocked = false; 

initUI({
    onJump: jump,
    onShoot: () => shoot(scene),
    onGrassChange: (val) => { levelState.grassParams.count = val; generateInstancedGrass(scene); }
});

window.addEventListener('loadParticles', (e) => updateAllOrbParticles(e.detail));

const loadingManager = new THREE.LoadingManager();
loadLevel(scene, loadingManager, './assets/models/MN_SCENE_01.gltf');
loadPlayer(scene, loadingManager);

loadingManager.onLoad = () => {
    // Escena cargada
};

// --- GESTIÓN DE AUDIO ---
const unlockAudio = async () => {
    await Tone.start();
    console.log("Tone.js Context Started");
    audioUnlocked = true; 

    if(!audioAmbient) {
        audioAmbient = new Tone.Player({
            url: './assets/sound/forest.mp3',
            loop: true,
            volume: -10 
        }).toDestination();
        audioAmbient.autostart = true; 
    }

    unlockPlayerAudio();
    unlockLevelAudio();

    window.removeEventListener('click', unlockAudio);
    if(msgDisplay && msgDisplay.innerText.includes("clic")) msgDisplay.style.display = 'none';
};
window.addEventListener('click', unlockAudio);

// --- LÓGICA DE JUEGO ---
let questState = 0; let currentPhase = 0; let cinematicStartTime = 0; let orbsLaunched = false;
const raycaster = new THREE.Raycaster(); const clock = new THREE.Clock(); 

function checkPlatform() { 
    if(!playerState.container || !levelState.platformMesh) return false; 
    raycaster.set(playerState.container.position.clone().add(new THREE.Vector3(0,1,0)), new THREE.Vector3(0,-1,0)); 
    raycaster.far = 2.0; 
    return raycaster.intersectObject(levelState.platformMesh, false).length > 0; 
}

function updateQuestLogic(dt, time) {
    if (questState === 0) {
        if (!audioUnlocked) {
            if (msgDisplay) { msgDisplay.innerText = "Haz clic para iniciar Audio"; msgDisplay.style.display = 'block'; }
        } else {
            if (msgDisplay && msgDisplay.innerText.includes("clic")) msgDisplay.style.display = 'none';
        }

        if (checkPlatform()) { 
            questState = 1; 
            cinematicStartTime = time; 
            orbsLaunched = false; 
            if(msgDisplay) { msgDisplay.style.display = 'block'; msgDisplay.innerText = "ESPERA..."; setTimeout(() => msgDisplay.style.display = 'none', 5000); } 
            
            playOrbAppearSound(); 
            spawnOrbsAtDoor(playerState.container.position); 
            const d = new THREE.Vector3(); camera.getWorldDirection(d); 
            startCameraCinematic(camera, camera.position.clone().add(d)); 
        }
    } else if (questState === 1) {
        const cinTime = time - cinematicStartTime; 
        if (cinTime > 5.0 && !orbsLaunched) { launchOrbs(camera.position, time); orbsLaunched = true; } 
        if (cinTime > 6.5) { 
            startCameraReturn(camera, playerState.container.position, levelState.doorsCenter); 
            questState = 2; 
            startOrbMelodies();
        }
    } else if (questState === 2) {
        const playerPos = playerState.container.position;
        const phaseUp = updateOrbsLogic(dt, time, playerPos, camera.position, 0, currentPhase);
        if(phaseUp) currentPhase++;

        let collectedCount = 0;
        const playerBack = new THREE.Vector3(0, 0, -1).applyQuaternion(playerState.container.quaternion).normalize();

        levelState.orbs.forEach((orb, i) => { 
            if (orb.state === 'editor_mode') return; 
            if(orb.collected) { 
                collectedCount++; 
                const distanceBehind = 1.2 + (i * 0.8); 
                const target = playerState.container.position.clone().add(playerBack.clone().multiplyScalar(distanceBehind));
                target.y += 1.2; orb.mesh.position.lerp(target, 4 * dt); 
            } 
        });

        if (collectedCount === 3) {
            if(checkPlatform()) {
                if (Math.abs(playerState.speed) < 0.1) { 
                    questState = 3; 
                    levelState.orbs.forEach(o => { o.mesh.visible = false; if(o.particles) o.particles.stop(); });
                    levelState.doorActions.forEach(a => a.play()); 
                    if(msgDisplay) { msgDisplay.innerText = "PUERTA ABIERTA"; msgDisplay.style.display = 'block'; } 
                } else { 
                    if(msgDisplay) { msgDisplay.innerText = "QUIETO EN EL ALTAR"; msgDisplay.style.display = 'block'; } 
                } 
            } else { if(msgDisplay) { msgDisplay.innerText = "VUELVE AL ALTAR"; msgDisplay.style.display = 'block'; } }
        } else { if(msgDisplay && !msgDisplay.innerText.includes("clic")) msgDisplay.style.display = 'none'; }
    }
}

let frames = 0, lastTime = performance.now();
function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    const elapsedTime = clock.getElapsedTime();
    const perfTime = performance.now();
    frames++; if (perfTime >= lastTime + 1000) { if(fpsDisplay) fpsDisplay.innerText = "FPS: " + frames; frames = 0; lastTime = perfTime; }

    const playerPos = playerState.container ? playerState.container.position : new THREE.Vector3(0,0,0);
    let cTime = 0; if(questState===1) cTime = elapsedTime - cinematicStartTime;
    
    if(questState !== 2) updateOrbsLogic(dt, elapsedTime, playerPos, camera.position, cTime, currentPhase);

    if (playerState.container) {
        sunLight.target.position.set(0, 0, playerState.container.position.z); sunLight.target.updateMatrixWorld(); sunLight.position.copy(sunLight.target.position).add(sunOffset);
        if (levelState.bgMesh) levelState.bgMesh.position.copy(camera.position);
        updateQuestLogic(dt, elapsedTime);
        const isCamActive = (questState === 1);
        updatePlayer(dt, camera, inputState.joystickVector, levelState.collisionMeshes, isCamActive);
        updateSmartCamera(camera, playerState.container, levelState.collisionMeshes, dt, levelState.doorsCenter);
    }
    if (levelState.sceneMixer) levelState.sceneMixer.update(dt);
    if (levelState.grassMaterialUniforms) levelState.grassMaterialUniforms.time.value = elapsedTime;
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => { 
    camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); 
});
animate();