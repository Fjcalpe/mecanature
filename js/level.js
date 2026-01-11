import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ParticleSystem3D } from './particles.js';

export const levelState = {
    collisionMeshes: [], 
    platformMesh: null, 
    grassEmitterMeshes: [],
    doorsCenter: new THREE.Vector3(), 
    doorActions: [], 
    sceneMixer: null,
    mapBoundingBox: new THREE.Box3(), 
    orbs: [],
    bgMesh: null, 
    parametricMesh: null, 
    levelMesh: null,
    grassSource: { geometry: null, material: null, scale: new THREE.Vector3(1,1,1) },
    grassMaterialUniforms: { time: { value: 0 } }, 
    grassParams: { count: 2000 }
};

class OrbLogic {
    constructor(id, mesh, light, scene) {
        this.id = id; this.mesh = mesh; this.light = light;
        this.state = 'hidden'; 
        this.target = new THREE.Vector3();
        this.velocity = new THREE.Vector3();
        this.collected = false;
        this.launchStartTime = 0;
        this.launchVelocity = new THREE.Vector3();
        this.divergeVec = new THREE.Vector3();
        this.oscillationOffset = Math.random() * 100;
        this.startCinematicPos = new THREE.Vector3();
        this.cinematicTargetPos = new THREE.Vector3();

        if(ParticleSystem3D) {
            // VALORES CARGADOS DESDE orb_design(1).json
            this.particles = new ParticleSystem3D(scene, {
                genType: 'glow',
                genColor: '#00b5f0',           // Color específico del JSON
                blendMode: 'add',
                emissionRate: 189,             // Valor del JSON
                spawnRadius: 0.5,              // Valor del JSON
                life: { min: 1, max: 2.1 },    // Valor del JSON
                speed: { value: 0.2, random: 0 }, // Valor del JSON
                scale: { start: 0.5, end: 0 },
                alpha: { start: 1, end: 0.35 },
                gravity: { x: 0, y: 0 },
                globalOpacity: 1
            });
            this.particles.stop();
        }
    }

    spawnStacked(basePos, playerPos) {
        this.state = 'cinematic_stack';
        this.collected = false;
        this.mesh.material.color.setHex(0xff0000); 
        this.light.color.setHex(0xff0000);
        
        const toDoor = new THREE.Vector3().subVectors(basePos, playerPos).normalize();
        this.startCinematicPos.copy(playerPos).add(toDoor.multiplyScalar(2.0));
        this.startCinematicPos.y += 1.5; 
        this.mesh.position.copy(this.startCinematicPos);
        this.mesh.position.y += (this.id * 0.6); 
        
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(toDoor, up).normalize();
        this.cinematicTargetPos.copy(this.mesh.position);
        this.cinematicTargetPos.y += 2.0; 
        if (this.id === 0) this.cinematicTargetPos.addScaledVector(right, -3.0);
        else if (this.id === 1) this.cinematicTargetPos.y += 2.0; 
        else if (this.id === 2) this.cinematicTargetPos.addScaledVector(right, 3.0);
    }

    launch(camPos, time) {
        this.state = 'launching';
        this.launchStartTime = time;
        const toCam = new THREE.Vector3().subVectors(camPos, this.mesh.position).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(toCam, up).normalize();
        const trueUp = new THREE.Vector3().crossVectors(right, toCam).normalize();
        
        if (this.id === 0) this.divergeVec.copy(right).multiplyScalar(-1);
        if (this.id === 1) this.divergeVec.copy(trueUp);
        if (this.id === 2) this.divergeVec.copy(right);
        
        this.launchVelocity.copy(toCam).multiplyScalar(20.0);
    }

    pickRandomTarget(bbox) {
        const width = Math.max(20, bbox.max.x - bbox.min.x);
        const depth = Math.max(20, bbox.max.z - bbox.min.z);
        this.target.set(
            bbox.min.x + Math.random() * width,
            1.5 + Math.random() * 1.5, 
            bbox.min.z + Math.random() * depth
        );
    }

    update(dt, time, playerPos, camPos, cinematicTime) {
        if(this.particles) {
            this.particles.setPosition(this.mesh.position);
            if(this.state !== 'hidden') this.particles.start();
            else this.particles.stop();
            this.particles.update(dt);
        }

        if(this.state === 'hidden' || this.state === 'editor_mode') return;

        if(this.state === 'cinematic_stack') {
            if (cinematicTime > 1.0) {
                const t = Math.min(1.0, (cinematicTime - 1.0) / 1.5); 
                const ease = t * t * (3 - 2 * t); 
                const temp = this.startCinematicPos.clone();
                temp.y += (this.id * 0.6);
                this.mesh.position.lerpVectors(temp, this.cinematicTargetPos, ease);
            } else {
                 this.mesh.position.y = this.startCinematicPos.y + (this.id * 0.6) + Math.sin(time * 5) * 0.05;
            }
            return;
        }

        if (this.state === 'launching') {
            const distToCam = this.mesh.position.distanceTo(camPos);
            if (distToCam < 8.0) this.launchVelocity.addScaledVector(this.divergeVec, 80.0 * dt);
            this.mesh.position.addScaledVector(this.launchVelocity, dt);
            if (this.mesh.position.y < 1.0) this.mesh.position.y = 1.0;
            
            if (time - this.launchStartTime > 1.5) {
                this.state = 'flying';
                this.mesh.material.color.setHex(0x00ffff);
                this.light.color.setHex(0x00ffff);
                this.pickRandomTarget(levelState.mapBoundingBox);
            }
            return;
        }

        if(this.state === 'flying') {
            const baseDir = new THREE.Vector3().subVectors(this.target, this.mesh.position).normalize();
            baseDir.x += Math.sin(time * 2.0 + this.oscillationOffset) * 0.5;
            baseDir.z += Math.cos(time * 2.0 + this.oscillationOffset) * 0.5;
            baseDir.normalize();
            
            const speed = 8 * 0.2; 
            this.mesh.position.addScaledVector(baseDir, speed * dt);
            
            if(this.mesh.position.distanceTo(this.target) < 2.0) this.pickRandomTarget(levelState.mapBoundingBox);
            this.mesh.position.y = Math.max(1, Math.min(4.5, this.mesh.position.y));
            
            if(playerPos.distanceTo(this.mesh.position) < 1.5) {
                this.state = 'following';
                this.collected = true;
            }
        }
    }
}

export function updateOrbsLogic(dt, time, playerPos, camPos, cinematicTime) {
    levelState.orbs.forEach(orb => orb.update(dt, time, playerPos, camPos, cinematicTime));
}

export function spawnOrbsAtDoor(playerPos) {
    levelState.orbs.forEach(orb => orb.spawnStacked(levelState.doorsCenter, playerPos));
}

export function launchOrbs(camPos, time) {
    levelState.orbs.forEach(orb => orb.launch(camPos, time));
}

export function updateAllOrbParticles(pixiConfig) {
    levelState.orbs.forEach(orb => {
        if(orb.particles) orb.particles.importPixiConfig(pixiConfig);
    });
}

export function loadLevel(scene, loadingManager, levelFile) {
    const loader = new GLTFLoader(loadingManager);
    
    if (!levelState.bgMesh) {
        const tLoader = new THREE.TextureLoader();
        const bgTex = tLoader.load('./assets/textures/bg.webp', (t) => t.colorSpace = THREE.SRGBColorSpace);
        const bgMesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16).scale(-1, 1, 1), new THREE.MeshBasicMaterial({ map: bgTex, side: THREE.DoubleSide, depthWrite: false, fog: false, toneMapped: false }));
        bgMesh.rotation.y = THREE.MathUtils.degToRad(123);
        scene.add(bgMesh);
        levelState.bgMesh = bgMesh;
    }

    loader.load(levelFile, (gltf) => {
        const masterModule = gltf.scene;
        scene.add(masterModule);
        levelState.levelMesh = masterModule;
        levelState.sceneMixer = new THREE.AnimationMixer(masterModule);
        let doorsCount = 0;
        levelState.mapBoundingBox.makeEmpty();

        masterModule.traverse((child) => {
            if (child.isMesh) {
                const name = child.name.toLowerCase();
                if (name.includes("collision") || name.includes("colision")) {
                    levelState.collisionMeshes.push(child); child.visible = false;
                    if (name.includes("plataforma")) levelState.platformMesh = child;
                    child.geometry.computeBoundingBox();
                    const box = child.geometry.boundingBox.clone(); box.applyMatrix4(child.matrixWorld); levelState.mapBoundingBox.union(box);
                } else if (name.includes("emisor_hierba")) {
                    levelState.grassEmitterMeshes.push(child); child.visible = false;
                } else if (name.includes("hierba_b")) {
                    if (!levelState.grassSource.geometry) {
                        levelState.grassSource.geometry = child.geometry.clone(); 
                        levelState.grassSource.material = child.material; 
                        levelState.grassSource.scale.copy(child.scale);
                    } child.visible = false;
                } else if (name.includes("puerta")) {
                    levelState.doorsCenter.add(child.position); doorsCount++;
                    child.castShadow = true; child.receiveShadow = true;
                } else { 
                    child.castShadow = true; child.receiveShadow = true; 
                }
            }
        });
        if(doorsCount > 0) levelState.doorsCenter.divideScalar(doorsCount);

        gltf.animations.forEach((clip) => {
            if(clip.name.toLowerCase().includes("puerta")) {
                const action = levelState.sceneMixer.clipAction(clip);
                action.loop = THREE.LoopOnce; action.clampWhenFinished = true; action.stop();
                levelState.doorActions.push(action);
            }
        });

        for(let i=0; i<3; i++) {
            const mesh = new THREE.Mesh(
                // Radio y segmentos del JSON
                new THREE.SphereGeometry(0.3, 16, 16), 
                new THREE.MeshStandardMaterial({ 
                    color: 0x00ffff, 
                    emissive: 0x004444,
                    roughness: 0.2,
                    metalness: 0.5
                })
            );
            // Configuración de Luz del JSON (intensidad 20, distancia 12, decay 1.9)
            const light = new THREE.PointLight(0x00ffff, 20, 12, 1.9);
            mesh.add(light);
            scene.add(mesh);
            levelState.orbs.push(new OrbLogic(i, mesh, light, scene)); 
            mesh.position.set(0, -9999, 0); 
        }

        if (levelState.grassSource.geometry) {
            generateInstancedGrass(scene);
        } else {
            console.warn("No se encontró el objeto 'hierba_b' para clonar.");
        }
    });
}

export function unloadCurrentLevel(scene) {
    if (levelState.parametricMesh) { 
        scene.remove(levelState.parametricMesh); 
        levelState.parametricMesh.geometry.dispose(); 
        levelState.parametricMesh = null; 
    }
    
    levelState.orbs.forEach(orb => { 
        if(orb.particles) orb.particles.dispose(); 
        scene.remove(orb.mesh); 
        orb.mesh.geometry.dispose(); 
        orb.mesh.material.dispose(); 
    });
    levelState.orbs = [];

    if (levelState.levelMesh) { 
        levelState.levelMesh.traverse((c) => { 
            if (c.isMesh) { 
                c.geometry.dispose(); 
                if(c.material.map) c.material.map.dispose(); 
                c.material.dispose(); 
            } 
        }); 
        scene.remove(levelState.levelMesh); 
        levelState.levelMesh = null; 
    }
    
    levelState.collisionMeshes = []; 
    levelState.grassEmitterMeshes = []; 
    levelState.doorActions = []; 
    levelState.platformMesh = null; 
    levelState.sceneMixer = null; 
    levelState.mapBoundingBox.makeEmpty();
}

function modifyMaterialForWind(material) {
    if(material.userData && material.userData.isWindy) return material;

    const newMat = material.clone();
    newMat.onBeforeCompile = (shader) => {
        shader.uniforms.time = levelState.grassMaterialUniforms.time;
        
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
            uniform float time;`
        );
        
        const shaderLogic = `
            #include <begin_vertex>
            float h = max(0.0, transformed.y); 
            float worldX = instanceMatrix[3][0] + transformed.x; 
            float worldZ = instanceMatrix[3][2] + transformed.z; 
            float windWave = sin(time * 3.0 - worldX * 0.5 + worldZ * 0.2); 
            float bend = windWave * -0.25 * h * h; 
            vec3 localWindDir = normalize(vec3(instanceMatrix[0].x, instanceMatrix[1].x, instanceMatrix[2].x)); 
            transformed += localWindDir * bend; 
            vec3 localCrossDir = normalize(vec3(instanceMatrix[0].z, instanceMatrix[1].z, instanceMatrix[2].z)); 
            transformed += localCrossDir * bend * 0.2;
        `;
        
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', shaderLogic);
    };
    newMat.customProgramCacheKey = () => 'windyGrassInverted';
    newMat.userData.isWindy = true; 
    return newMat;
}

export function generateInstancedGrass(scene) {
    if (levelState.parametricMesh) { 
        scene.remove(levelState.parametricMesh); 
        levelState.parametricMesh.dispose(); 
        levelState.parametricMesh = null; 
    }

    if (!levelState.grassSource.geometry || !levelState.grassSource.material) return;
    if (levelState.grassParams.count === 0) return;
    if (levelState.grassEmitterMeshes.length === 0) return;

    if (levelState.mapBoundingBox.isEmpty()) { 
        levelState.mapBoundingBox.min.set(-200, -50, -200); 
        levelState.mapBoundingBox.max.set(200, 50, 200); 
    }

    const count = levelState.grassParams.count;
    const windMaterial = modifyMaterialForWind(levelState.grassSource.material);
    
    // MeshDepthMaterial limpio para sombras (Fix: Illegal Feedback)
    const depthMat = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking
    });

    depthMat.onBeforeCompile = (shader) => {
        shader.uniforms.time = levelState.grassMaterialUniforms.time;
        shader.vertexShader = `uniform float time;\n` + shader.vertexShader;
        
        const shaderLogic = `
            #include <begin_vertex>
            float h = max(0.0, transformed.y); 
            float worldX = instanceMatrix[3][0] + transformed.x; 
            float worldZ = instanceMatrix[3][2] + transformed.z; 
            float windWave = sin(time * 3.0 - worldX * 0.5 + worldZ * 0.2); 
            float bend = windWave * -0.25 * h * h; 
            vec3 localWindDir = normalize(vec3(instanceMatrix[0].x, instanceMatrix[1].x, instanceMatrix[2].x)); 
            transformed += localWindDir * bend; 
            vec3 localCrossDir = normalize(vec3(instanceMatrix[0].z, instanceMatrix[1].z, instanceMatrix[2].z)); 
            transformed += localCrossDir * bend * 0.2;
        `;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', shaderLogic);
    };

    levelState.parametricMesh = new THREE.InstancedMesh(levelState.grassSource.geometry, windMaterial, count);
    levelState.parametricMesh.castShadow = true; 
    levelState.parametricMesh.receiveShadow = true; 
    levelState.parametricMesh.frustumCulled = false; 
    
    levelState.parametricMesh.customDepthMaterial = depthMat;

    const dummy = new THREE.Object3D(); 
    const localRaycaster = new THREE.Raycaster(); 
    localRaycaster.far = 100.0; 
    const localDown = new THREE.Vector3(0, -1, 0);
    
    let placed = 0; 
    let attempts = 0; 
    const maxAttempts = count * 5; 
    
    const width = levelState.mapBoundingBox.max.x - levelState.mapBoundingBox.min.x;
    const depth = levelState.mapBoundingBox.max.z - levelState.mapBoundingBox.min.z;
    const heightMax = levelState.mapBoundingBox.max.y + 20; 
    const _tempVec3 = new THREE.Vector3();

    levelState.grassEmitterMeshes.forEach(m => m.visible = true);

    while(placed < count && attempts < maxAttempts) {
        attempts++; 
        const x = levelState.mapBoundingBox.min.x + Math.random() * width; 
        const z = levelState.mapBoundingBox.min.z + Math.random() * depth; 
        _tempVec3.set(x, heightMax, z);
        
        localRaycaster.set(_tempVec3, localDown); 
        const hits = localRaycaster.intersectObjects(levelState.grassEmitterMeshes, true);
        
        if (hits.length === 0) continue; 
        const hit = hits[0]; 
        if (hit.face && hit.face.normal.y < 0.6) continue;

        dummy.position.set(x, hit.point.y, z); 
        dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
        
        const randomScale = 0.6 + Math.random() * 0.7;
        dummy.scale.set(
            levelState.grassSource.scale.x * randomScale, 
            levelState.grassSource.scale.y * randomScale * (0.8 + Math.random()*0.4), 
            levelState.grassSource.scale.z * randomScale
        );
        
        dummy.updateMatrix(); 
        levelState.parametricMesh.setMatrixAt(placed, dummy.matrix); 
        placed++;
    }

    levelState.grassEmitterMeshes.forEach(m => m.visible = false);

    for(let i = placed; i < count; i++) { 
        dummy.position.set(0, -99999, 0); 
        dummy.updateMatrix(); 
        levelState.parametricMesh.setMatrixAt(i, dummy.matrix); 
    }

    levelState.parametricMesh.instanceMatrix.needsUpdate = true; 
    scene.add(levelState.parametricMesh);
    console.log(`Hierba generada: ${placed} instancias.`);
}