import * as THREE from 'three';
import { playerState } from './player.js'; // Necesitamos saber si está surfeando

export const camSettings = { 
    radius: 4.5, minRadius: 1.5, currentRadius: 4.5, 
    theta: Math.PI, phi: 0.45 
};

let isCinematic = false;
let isReturning = false;
let cinematicStartTime = 0;
let returnStartTime = 0;

const _camIdeal = new THREE.Vector3();
const _camHead = new THREE.Vector3();
const _currentLookAt = new THREE.Vector3();
const _cinematicStartPos = new THREE.Vector3();
const _cinematicStartLook = new THREE.Vector3();
const _returnStartLook = new THREE.Vector3();
let _returnStartRadius, _returnStartPhi, _returnStartTheta;
let isLookAtInitialized = false;

let isDraggingCamera = false;
let previousMousePosition = { x: 0, y: 0 };

document.addEventListener('pointerdown', (e) => { 
    if (e.target.closest('.ui-element')) return; 
    isDraggingCamera = true; previousMousePosition = { x: e.clientX, y: e.clientY }; 
});
document.addEventListener('pointermove', (e) => { 
    if (!isDraggingCamera) return; 
    const deltaX = e.clientX - previousMousePosition.x; 
    const deltaY = e.clientY - previousMousePosition.y; 
    camSettings.theta -= deltaX * 0.008; 
    camSettings.phi -= deltaY * 0.008; 
    camSettings.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, camSettings.phi)); 
    previousMousePosition = { x: e.clientX, y: e.clientY }; 
});
document.addEventListener('pointerup', () => isDraggingCamera = false);

export function startCameraCinematic(camera, currentLookAt) {
    isCinematic = true;
    isReturning = false;
    cinematicStartTime = performance.now() / 1000;
    _cinematicStartPos.copy(camera.position);
    _cinematicStartLook.copy(currentLookAt);
    document.body.classList.add('cinematic-mode');
}

export function startCameraReturn(camera, playerPos, doorsCenter) {
    isCinematic = false;
    isReturning = true;
    returnStartTime = performance.now() / 1000;

    const offset = new THREE.Vector3().subVectors(camera.position, playerPos);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    
    _returnStartRadius = spherical.radius;
    _returnStartPhi = spherical.phi;
    _returnStartTheta = spherical.theta;
    _returnStartLook.copy(_currentLookAt);

    const dirToStage = new THREE.Vector3().subVectors(playerPos, doorsCenter).normalize();
    const angle = Math.atan2(dirToStage.x, dirToStage.z);

    camSettings.theta = angle + Math.PI; 
    camSettings.phi = 0.87;     
    camSettings.radius = 4.17;  
    camSettings.currentRadius = 4.17;
}

export function updateSmartCamera(camera, playerContainer, collisionMeshes, dt, doorsCenter) {
    if (!playerContainer) return;

    const time = performance.now() / 1000;

    if (isCinematic) {
        const localTime = time - cinematicStartTime;
        const toDoorDir = new THREE.Vector3().subVectors(doorsCenter, playerContainer.position).normalize();
        
        const view1Pos = playerContainer.position.clone().sub(toDoorDir.clone().multiplyScalar(3.0)).add(new THREE.Vector3(0, 1.5, 0));
        const view2Pos = playerContainer.position.clone().sub(toDoorDir.clone().multiplyScalar(15.0)).add(new THREE.Vector3(0, 6.0, 0));
        const lookAtDoor = doorsCenter.clone().add(new THREE.Vector3(0, 2, 0));
        
        if (localTime < 2.0) {
            const t = localTime / 2.0; 
            const smoothT = t * t * (3 - 2 * t);
            camera.position.lerpVectors(_cinematicStartPos, view1Pos, smoothT);
            camera.lookAt(new THREE.Vector3().lerpVectors(_cinematicStartLook, lookAtDoor, smoothT));
            _currentLookAt.copy(lookAtDoor); 
        } else if (localTime < 5.0) {
            const t = (localTime - 2.0) / 3.0;
            const smoothT = t * t * (3 - 2 * t);
            camera.position.lerpVectors(view1Pos, view2Pos, smoothT);
            camera.lookAt(lookAtDoor);
        } else {
            camera.position.copy(view2Pos);
            camera.lookAt(lookAtDoor);
        }
        return;
    }

    if (isReturning) {
        const localTime = time - returnStartTime;
        const duration = 2.0; 
        
        if (localTime < duration) {
            const t = localTime / duration;
            const smoothT = t * t * (3 - 2 * t);
            const radiusT = Math.min(1.0, smoothT * 3.0); 
            const curRadius = THREE.MathUtils.lerp(_returnStartRadius, camSettings.radius, radiusT);
            const curPhi = THREE.MathUtils.lerp(_returnStartPhi, camSettings.phi, smoothT);
            
            let startTheta = _returnStartTheta;
            let endTheta = camSettings.theta;
            if (endTheta - startTheta > Math.PI) endTheta -= Math.PI * 2;
            if (endTheta - startTheta < -Math.PI) endTheta += Math.PI * 2;
            
            const curTheta = THREE.MathUtils.lerp(startTheta, endTheta, smoothT);

            const y = curRadius * Math.cos(curPhi);
            const x = curRadius * Math.sin(curPhi) * Math.sin(curTheta);
            const z = curRadius * Math.sin(curPhi) * Math.cos(curTheta);

            _camIdeal.set(x, y, z).add(playerContainer.position);
            _camHead.copy(playerContainer.position).y += 1.5; 
            
            const lerpedLook = new THREE.Vector3().lerpVectors(_returnStartLook, _camHead, smoothT);
            camera.position.copy(_camIdeal);
            camera.lookAt(lerpedLook);
            _currentLookAt.copy(lerpedLook);
        } else {
            isReturning = false;
            document.body.classList.remove('cinematic-mode');
        }
        return;
    }

    // --- MODO NORMAL ---
    _camIdeal.set(
        camSettings.radius * Math.sin(camSettings.phi) * Math.sin(camSettings.theta),
        camSettings.radius * Math.cos(camSettings.phi),
        camSettings.radius * Math.sin(camSettings.phi) * Math.cos(camSettings.theta)
    ).add(playerContainer.position);

    // AJUSTE DE ALTURA DINÁMICO
    // Si estamos surfeando, bajamos el objetivo para ver mejor la máscara
    let targetHeadY = 1.5; 
    if (playerState.standingOnEnemy) {
        targetHeadY = -0.5; // Bajamos la vista para centrar la acción más abajo
    }

    _camHead.copy(playerContainer.position);
    _camHead.y += targetHeadY;

    // Colisión de cámara
    const _tempDir = new THREE.Vector3().subVectors(_camIdeal, _camHead).normalize();
    const raycaster = new THREE.Raycaster(_camHead, _tempDir, 0, camSettings.radius);
    const hits = raycaster.intersectObjects(collisionMeshes, true);
    camSettings.currentRadius = hits.length > 0 ? Math.max(camSettings.minRadius, hits[0].distance - 0.2) : camSettings.radius;

    const finalPos = new THREE.Vector3(
        camSettings.currentRadius * Math.sin(camSettings.phi) * Math.sin(camSettings.theta),
        camSettings.currentRadius * Math.cos(camSettings.phi),
        camSettings.currentRadius * Math.sin(camSettings.phi) * Math.cos(camSettings.theta)
    ).add(playerContainer.position);
    
    // Suavizado
    camera.position.lerp(finalPos, 0.25);

    const targetLook = playerContainer.position.clone();
    targetLook.y += targetHeadY;
    
    if (!isLookAtInitialized) { _currentLookAt.copy(targetLook); isLookAtInitialized = true; }
    _currentLookAt.lerp(targetLook, 0.1); 
    camera.lookAt(_currentLookAt);
}