import * as THREE from 'three';
import { loadPlayer, updatePlayer, playerState, jump, shoot } from './player.js';
import { updateSmartCamera, camSettings, startCameraCinematic, startCameraReturn } from './camera.js';
import { loadLevel, levelState, spawnOrbsAtDoor, launchOrbs, updateOrbsLogic, generateInstancedGrass, updateAllOrbParticles } from './level.js';
import { InGameEditor } from './editor_ui.js'; 
import { initUI, inputState, fpsDisplay, msgDisplay } from './ui_manager.js';

// --- CONFIGURACIÓN ESCENA ---
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

// --- ILUMINACIÓN ---
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
sunLight.shadow.camera.left = -20; sunLight.shadow.camera.right = 20; 
sunLight.shadow.camera.top = 20; sunLight.shadow.camera.bottom = -20;
sunLight.shadow.camera.near = 0.5; sunLight.shadow.camera.far = 150;
sunLight.shadow.bias = -0.0005; 
sunLight.shadow.normalBias = 0.05; 
scene.add(sunLight); scene.add(sunLight.target); 
scene.add(new THREE.HemisphereLight(0xffd580, 0x222233, 0.5));

// --- ENVIRONMENT MAP ---
new THREE.TextureLoader().load('./assets/textures/bg_reflejosIBL.webp', (t) => { 
    t.mapping = THREE.EquirectangularReflectionMapping; 
    t.colorSpace = THREE.SRGBColorSpace; 
    scene.environment = t; 
    scene.environmentIntensity = 2.0; 
    if(scene.environmentRotation) scene.environmentRotation.y = THREE.MathUtils.degToRad(334); 
});

// --- INICIALIZAR UI Y INPUTS ---
initUI({
    onJump: jump,
    onShoot: () => shoot(scene),
    onGrassChange: (val) => {
        levelState.grassParams.count = val; 
        generateInstancedGrass(scene);
    }
});

window.addEventListener('loadParticles', (e) => updateAllOrbParticles(e.detail));

// --- CARGA DE ASSETS ---
const loadingManager = new THREE.LoadingManager();
loadLevel(scene, loadingManager, './assets/models/MN_SCENE_01.gltf');
loadPlayer(scene, loadingManager);

loadingManager.onLoad = () => {
    if (typeof InGameEditor !== 'undefined' && levelState.orbs.length > 0) {
        new InGameEditor(scene, camera, renderer, levelState.orbs);
    }
};

// --- LÓGICA DE JUEGO ---
let questState = 0; 
let cinematicStartTime = 0; 
let orbsLaunched = false;
const raycaster = new THREE.Raycaster();
const clock = new THREE.Clock(); 

function checkPlatform() { 
    if(!playerState.container || !levelState.platformMesh) return false; 
    raycaster.set(playerState.container.position.clone().add(new THREE.Vector3(0,1,0)), new THREE.Vector3(0,-1,0)); 
    raycaster.far = 2.0; 
    return raycaster.intersectObject(levelState.platformMesh, false).length > 0; 
}

function updateQuestLogic(dt, time) {
    if (questState === 0) {
        if (checkPlatform()) { 
            questState = 1; 
            cinematicStartTime = time; 
            orbsLaunched = false; 
            if(msgDisplay) { msgDisplay.style.display = 'block'; setTimeout(() => msgDisplay.style.display = 'none', 5000); } 
            spawnOrbsAtDoor(playerState.container.position); 
            
            const d = new THREE.Vector3(); 
            camera.getWorldDirection(d); 
            startCameraCinematic(camera, camera.position.clone().add(d)); 
        }
    } else if (questState === 1) {
        const cinTime = time - cinematicStartTime; 
        if (cinTime > 5.0 && !orbsLaunched) { 
            launchOrbs(camera.position, time); 
            orbsLaunched = true; 
        } 
        if (cinTime > 6.5) { 
            startCameraReturn(camera, playerState.container.position, levelState.doorsCenter); 
            questState = 2; 
        }
    } else if (questState === 2) {
        // --- LÓGICA DE COLA / SEGUIMIENTO ---
        let collectedCount = 0;
        
        // CORRECCIÓN: Invertido a (0, 0, -1) para que apunte hacia ATRÁS
        const playerBack = new THREE.Vector3(0, 0, -1).applyQuaternion(playerState.container.quaternion).normalize();
        const baseHeight = 1.2;

        levelState.orbs.forEach((orb, i) => { 
            if (orb.state === 'editor_mode') return; 
            if(orb.collected) { 
                collectedCount++; 
                
                // Orbe 0: Cerca. Orbe 1: Más atrás...
                const distanceBehind = 1.2 + (i * 0.8); 
                
                // Objetivo: Posición + (Dirección Atrás * Distancia)
                const target = playerState.container.position.clone()
                    .add(playerBack.clone().multiplyScalar(distanceBehind));
                target.y += baseHeight; 

                orb.mesh.position.lerp(target, 4 * dt); 
            } 
        });

        if (collectedCount === 3) {
            if(checkPlatform()) {
                if (Math.abs(playerState.speed) < 0.1) { 
                    questState = 3; 
                    
                    // OCULTAR ORBES
                    levelState.orbs.forEach(o => {
                        o.mesh.visible = false;
                        if(o.particles) o.particles.stop();
                    });

                    levelState.doorActions.forEach(a => a.play()); 
                    if(msgDisplay) { msgDisplay.innerText = "PUERTA ABIERTA"; msgDisplay.style.display = 'block'; } 
                } else { 
                    if(msgDisplay) { msgDisplay.innerText = "QUIETO EN EL ALTAR"; msgDisplay.style.display = 'block'; } 
                } 
            } else {
                 if(msgDisplay) { msgDisplay.innerText = "VUELVE AL ALTAR"; msgDisplay.style.display = 'block'; }
            }
        } else { 
            if(msgDisplay) msgDisplay.style.display = 'none'; 
        }
    }
}

// --- BUCLE PRINCIPAL ---
let frames = 0, lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);
    
    const dt = Math.min(clock.getDelta(), 0.1);
    const elapsedTime = clock.getElapsedTime();
    const perfTime = performance.now();

    frames++; 
    if (perfTime >= lastTime + 1000) { 
        if(fpsDisplay) fpsDisplay.innerText = "FPS: " + frames; 
        frames = 0; lastTime = perfTime; 
    }

    const playerPos = playerState.container ? playerState.container.position : new THREE.Vector3(0,0,0);
    let cTime = 0; if(questState===1) cTime = elapsedTime - cinematicStartTime;
    
    updateOrbsLogic(dt, elapsedTime, playerPos, camera.position, cTime);

    if (playerState.container) {
        sunLight.target.position.set(0, 0, playerState.container.position.z); 
        sunLight.target.updateMatrixWorld(); 
        sunLight.position.copy(sunLight.target.position).add(sunOffset);
        
        if (levelState.bgMesh) levelState.bgMesh.position.copy(camera.position);

        updateQuestLogic(dt, elapsedTime);

        const isCamActive = (questState === 1);
        updatePlayer(dt, camera, inputState.joystickVector, levelState.collisionMeshes, isCamActive);
        updateSmartCamera(camera, playerState.container, levelState.collisionMeshes, dt, levelState.doorsCenter);
    }

    if (levelState.sceneMixer) levelState.sceneMixer.update(dt);
    
    if (levelState.grassMaterialUniforms) {
        levelState.grassMaterialUniforms.time.value = elapsedTime;
    }
    
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => { 
    camera.aspect = window.innerWidth/window.innerHeight; 
    camera.updateProjectionMatrix(); 
    renderer.setSize(window.innerWidth, window.innerHeight); 
});

animate();