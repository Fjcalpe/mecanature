import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let stepGrass = null;
let stepStone = null;

function initStepAudio() {
    if(!stepGrass) {
        stepGrass = new Tone.Player({
            url: './assets/sound/run_grass.mp3',
            loop: true,
            volume: -6 
        }).toDestination();
    }
    if(!stepStone) {
        stepStone = new Tone.Player({
            url: './assets/sound/run_seco.mp3',
            loop: true,
            volume: -3
        }).toDestination();
    }
}

export function unlockPlayerAudio() {
    initStepAudio();
}

export const playerState = {
    container: null,
    mixer: null,
    actions: {},        
    activeAction: null, 
    velocity: new THREE.Vector3(),
    velocityY: 0,
    isGrounded: false,
    landingCooldown: 0,
    isMoving: false,
    speed: 0,
    currentSurface: 'grass',
    // Velocidades fijadas por petición
    animSpeeds: {
        walk: 1.6,
        jump: 0.6
    }
};

const keyStates = { w: false, a: false, s: false, d: false };
const moveDirection = new THREE.Vector3();
const maxMoveSpeed = 7.5;
const gravity = -50.0;
const jumpStrength = 18.0;

window.addEventListener('keydown', (e) => { 
    if(e.code==='KeyW') keyStates.w = true; 
    if(e.code==='KeyS') keyStates.s = true; 
    if(e.code==='KeyA') keyStates.a = true; 
    if(e.code==='KeyD') keyStates.d = true; 
    if(e.code==='Space') jump(); 
});
window.addEventListener('keyup', (e) => { 
    if(e.code==='KeyW') keyStates.w = false; 
    if(e.code==='KeyS') keyStates.s = false; 
    if(e.code==='KeyA') keyStates.a = false; 
    if(e.code==='KeyD') keyStates.d = false; 
});

export function loadPlayer(scene, loadingManager) {
    const loader = new GLTFLoader(loadingManager);
    loader.load('./assets/models/GIRLrun.gltf', (gltf) => { 
        const rawMesh = gltf.scene;
        rawMesh.scale.set(1.2, 1.2, 1.2);
        
        playerState.container = new THREE.Group();
        playerState.container.position.set(0, 3, 0);
        scene.add(playerState.container);

        const box = new THREE.Box3().setFromObject(rawMesh);
        const center = box.getCenter(new THREE.Vector3());
        rawMesh.position.set(-center.x, -box.min.y, -center.z);
        playerState.container.add(rawMesh);
        
        rawMesh.traverse((child) => { 
            if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; } 
        });

        if (gltf.animations && gltf.animations.length > 0) {
            playerState.mixer = new THREE.AnimationMixer(rawMesh);
            
            gltf.animations.forEach((clip) => {
                const name = clip.name;
                const action = playerState.mixer.clipAction(clip);
                const lower = name.toLowerCase();
                
                if (lower.includes('idle')) playerState.actions['Idle'] = action;
                else if (lower.includes('run')) playerState.actions['Run'] = action;
                else if (lower.includes('jump') || name.includes('Armature.001')) playerState.actions['Jump'] = action;
                else if (lower.includes('walk') || (name.includes('Armature|mixamo') && !name.includes('.001'))) playerState.actions['Walk'] = action;

                playerState.actions[name] = action;
            });

            if(playerState.actions['Idle']) {
                playerState.activeAction = playerState.actions['Idle'];
                playerState.activeAction.play();
            }
        }
    });
}

export function jump() {
    if (playerState.isGrounded) {
        playerState.velocityY = jumpStrength;
        playerState.isGrounded = false;
    }
}

export function updatePlayer(dt, camera, joystickVector, collisionMeshes, isCinematic) {
    if (!playerState.container) return;

    if (isCinematic) {
        playerState.speed = 0; playerState.isMoving = false;
        changeAction('Idle', 0.5);
        if (playerState.mixer) playerState.mixer.update(dt);
        return;
    }

    if (playerState.landingCooldown > 0) playerState.landingCooldown -= dt;
    
    let inputX = joystickVector.x; let inputY = joystickVector.y;
    if (keyStates.w) inputY -= 1; if (keyStates.s) inputY += 1;
    if (keyStates.a) inputX -= 1; if (keyStates.d) inputX += 1;

    moveDirection.set(inputX, 0, inputY);
    const len = moveDirection.length();
    
    if (len > 0.1 && playerState.landingCooldown <= 0) {
        playerState.isMoving = true;
        playerState.speed = (len > 1 ? maxMoveSpeed : maxMoveSpeed * len);
    } else {
        playerState.isMoving = false;
        playerState.speed = 0;
    }

    if (playerState.isMoving) {
        const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
        camera.getWorldDirection(_v1); _v1.y = 0; _v1.normalize(); 
        _v2.crossVectors(new THREE.Vector3(0, 1, 0), _v1).normalize(); 
        const finalDir = _v1.clone().multiplyScalar(-moveDirection.z).addScaledVector(_v2, -moveDirection.x).normalize();

        const ray = new THREE.Raycaster(playerState.container.position.clone().add(new THREE.Vector3(0,1,0)), finalDir, 0, 0.8);
        if (ray.intersectObjects(collisionMeshes, true).length === 0) {
            playerState.container.position.addScaledVector(finalDir, playerState.speed * dt);
        }
        playerState.container.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(finalDir.x, finalDir.z)), 10 * dt);
    }

    playerState.velocityY += gravity * dt;
    const propY = playerState.container.position.y + playerState.velocityY * dt;
    const floorInfo = getFloorInfo(playerState.container.position, playerState.container.position.y, collisionMeshes);
    
    if (propY <= floorInfo.y && playerState.velocityY <= 0) {
        playerState.container.position.y = floorInfo.y;
        playerState.velocityY = 0;
        playerState.isGrounded = true;
    } else {
        playerState.container.position.y = propY;
        playerState.isGrounded = false;
    }

    if (playerState.mixer) {
        let nextActionName = 'Idle';
        if (!playerState.isGrounded) nextActionName = 'Jump';
        else if (playerState.isMoving) nextActionName = (playerState.speed > 4.0) ? 'Run' : 'Walk';

        if (!playerState.actions[nextActionName]) {
            if (nextActionName === 'Walk') nextActionName = 'Run';
            else if (nextActionName === 'Jump') nextActionName = 'Idle';
        }

        changeAction(nextActionName, 0.2);

        const active = playerState.activeAction;
        if (active) {
            if (nextActionName === 'Run') {
                active.timeScale = playerState.speed / 7.5;
            } else if (nextActionName === 'Walk') {
                active.timeScale = (playerState.speed / 3.5) * playerState.animSpeeds.walk;
            } else if (nextActionName === 'Jump') {
                active.timeScale = playerState.animSpeeds.jump;
            } else {
                active.timeScale = 1.0;
            }
        }
        playerState.mixer.update(dt);
    }
    handleFootsteps();
}

function changeAction(name, duration) {
    const nextAction = playerState.actions[name];
    if (!nextAction || playerState.activeAction === nextAction) return;
    if (playerState.activeAction) playerState.activeAction.fadeOut(duration);
    nextAction.reset().fadeIn(duration).play();
    playerState.activeAction = nextAction;
}

function handleFootsteps() {
    if (!stepGrass || !stepStone) return;
    if (playerState.isGrounded && playerState.isMoving && playerState.speed > 0.1) {
        const speedRatio = Math.max(0.5, playerState.speed / maxMoveSpeed);
        if (playerState.currentSurface === 'stone') {
            if (stepGrass.state === 'started') stepGrass.stop();
            stepStone.playbackRate = speedRatio;
            if (stepStone.state !== 'started') stepStone.start();
        } else {
            if (stepStone.state === 'started') stepStone.stop();
            stepGrass.playbackRate = speedRatio;
            if (stepGrass.state !== 'started') stepGrass.start();
        }
    } else {
        if (stepGrass.state === 'started') stepGrass.stop();
        if (stepStone.state === 'started') stepStone.stop();
    }
}

function getFloorInfo(pos, currentY, meshes) {
    const origin = pos.clone().add(new THREE.Vector3(0, 2, 0));
    const ray = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, 10);
    const hits = ray.intersectObjects(meshes, true);
    return hits.length > 0 ? { y: hits[0].point.y, object: hits[0].object } : { y: -999, object: null };
}

export function shoot(scene) {}