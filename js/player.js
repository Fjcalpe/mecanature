import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const playerState = {
    container: null,
    mixer: null,
    velocity: new THREE.Vector3(),
    velocityY: 0,
    isGrounded: false,
    landingCooldown: 0,
    isMoving: false,
    speed: 0
};

const keyStates = { w: false, a: false, s: false, d: false };
const moveDirection = new THREE.Vector3();
const maxMoveSpeed = 7.5;
const gravity = -50.0;
const jumpStrength = 18.0;
const projectiles = [];
const projectileGeo = new THREE.BoxGeometry(0.1, 0.1, 0.8);
const projectileMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });

// Input Listeners
window.addEventListener('keydown', (e) => { 
    if(e.code==='KeyW') keyStates.w = true; 
    if(e.code==='KeyS') keyStates.s = true; 
    if(e.code==='KeyA') keyStates.a = true; 
    if(e.code==='KeyD') keyStates.d = true; 
    if(e.code==='Space') jump(); 
    if(e.code==='KeyP') shoot(window.scene); 
});
window.addEventListener('keyup', (e) => { 
    if(e.code==='KeyW') keyStates.w = false; 
    if(e.code==='KeyS') keyStates.s = false; 
    if(e.code==='KeyA') keyStates.a = false; 
    if(e.code==='KeyD') keyStates.d = false; 
});

export function loadPlayer(scene, loadingManager) {
    const loader = new GLTFLoader(loadingManager);
    
    // ---------------------------------------------------------
    // CORRECCIÓN AQUÍ: Quitamos "/character/" de la ruta.
    // Ahora busca en assets/models/GIRLrun.gltf directamente.
    // ---------------------------------------------------------
    loader.load('./assets/models/GIRLrun.gltf', (gltf) => { 
        
        const rawMesh = gltf.scene;
        rawMesh.scale.set(0.7, 0.7, 0.7);
        
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
            playerState.mixer.clipAction(gltf.animations[0]).play();
            playerState.mixer.timeScale = 0;
        }
    });
}

export function jump() {
    if (playerState.isGrounded) {
        playerState.velocityY = jumpStrength;
        playerState.isGrounded = false;
    }
}

export function shoot(scene) {
    if (!playerState.container || !scene) return;
    const proj = new THREE.Mesh(projectileGeo, projectileMat);
    proj.position.copy(playerState.container.position).add(new THREE.Vector3(0,1.2,0));
    const d = new THREE.Vector3();
    playerState.container.getWorldDirection(d);
    proj.quaternion.copy(playerState.container.quaternion);
    proj.userData.velocity = d.multiplyScalar(20);
    proj.userData.lifeTime = 2.0;
    scene.add(proj);
    projectiles.push(proj);
}

export function updatePlayer(dt, camera, joystickVector, collisionMeshes, isCinematic) {
    if (!playerState.container) return;

    // 1. Projectiles
    for (let i = projectiles.length - 1; i >= 0; i--) { 
        const p = projectiles[i]; 
        p.position.addScaledVector(p.userData.velocity, dt); 
        p.userData.lifeTime -= dt; 
        if (p.userData.lifeTime <= 0) { 
            if(p.parent) p.parent.remove(p); 
            projectiles.splice(i, 1); 
        }
    }

    if (isCinematic) {
        playerState.speed = 0;
        playerState.isMoving = false;
        if (playerState.mixer) {
            playerState.mixer.timeScale = 0;
            playerState.mixer.update(dt);
        }
        return;
    }

    // 2. Input
    if (playerState.landingCooldown > 0) playerState.landingCooldown -= dt;
    
    let inputX = joystickVector.x;
    let inputY = joystickVector.y;
    if (keyStates.w) inputY -= 1;
    if (keyStates.s) inputY += 1;
    if (keyStates.a) inputX -= 1;
    if (keyStates.d) inputX += 1;

    moveDirection.set(inputX, 0, inputY);
    const len = moveDirection.length();
    
    if (len > 0.1 && playerState.landingCooldown <= 0) {
        playerState.isMoving = true;
        playerState.speed = (len > 1 ? maxMoveSpeed : maxMoveSpeed * len);
    } else {
        playerState.isMoving = false;
        if (playerState.landingCooldown <= 0) playerState.speed = 0;
    }

    // 3. Movement
    if (playerState.isMoving) {
        const _tempVec3 = new THREE.Vector3();
        const _tempVec3_2 = new THREE.Vector3();
        
        camera.getWorldDirection(_tempVec3); 
        _tempVec3.y = 0; 
        _tempVec3.normalize(); 
        
        _tempVec3_2.crossVectors(new THREE.Vector3(0, 1, 0), _tempVec3).normalize(); 
        
        const finalDir = _tempVec3.clone().multiplyScalar(-moveDirection.z).addScaledVector(_tempVec3_2, -moveDirection.x).normalize();
        
        // Wall Check
        const raycaster = new THREE.Raycaster();
        const origin = playerState.container.position.clone();
        origin.y += 0.1;
        raycaster.set(origin, finalDir);
        raycaster.far = 0.6;
        const hits = raycaster.intersectObjects(collisionMeshes, true);
        const hitWall = hits.length > 0 && hits[0].face.normal.y < 0.707;

        if (!hitWall) {
            playerState.container.position.addScaledVector(finalDir, playerState.speed * dt);
        }
        
        playerState.container.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(finalDir.x, finalDir.z)), 10 * dt);
    }

    // 4. Gravity & Floor
    playerState.velocityY += gravity * dt;
    const propY = playerState.container.position.y + playerState.velocityY * dt;
    
    const floorY = getPlayerHeight(playerState.container.position, playerState.container.position.y, collisionMeshes);
    const distToFloor = playerState.container.position.y - floorY;

    if (floorY > -900) {
        if (playerState.isGrounded && distToFloor > 0 && distToFloor < 0.5 && playerState.velocityY <= 0) {
            playerState.container.position.y = THREE.MathUtils.lerp(playerState.container.position.y, floorY, 0.5);
            playerState.velocityY = 0;
            playerState.isGrounded = true;
        } else if (propY <= floorY && playerState.velocityY <= 0) {
            if (!playerState.isGrounded) playerState.landingCooldown = 0.2;
            playerState.container.position.y = THREE.MathUtils.lerp(playerState.container.position.y, floorY, 0.5);
            playerState.velocityY = 0;
            playerState.isGrounded = true;
        } else {
            playerState.container.position.y = propY;
            playerState.isGrounded = false;
        }
    } else {
        playerState.container.position.y = propY;
        playerState.isGrounded = false;
    }

    if (playerState.mixer) {
        playerState.mixer.timeScale = (playerState.isGrounded && playerState.isMoving) ? playerState.speed / maxMoveSpeed : 0;
        playerState.mixer.update(dt);
    }
}

function getPlayerHeight(pos, currentY, meshes) {
    if(playerState.velocityY > 0) return -999;
    const origin = pos.clone();
    origin.y += 1.5;
    const raycaster = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0));
    raycaster.far = 10.0;
    const hits = raycaster.intersectObjects(meshes, true);
    if (hits.length > 0) return hits[0].point.y;
    if (playerState.isGrounded && currentY > -100) return currentY;
    return -999;
}