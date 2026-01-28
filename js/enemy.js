import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { takeDamage } from './player.js';

export class Enemy {
    constructor(scene, config) {
        this.scene = scene;
        this.refObject = config.refObject;
        this.pathPoints = config.pathPoints || [];
        this.sceneMixer = config.mixer; 
        this.introClip = config.introClip;

        this.mesh = null;
        this.collisionTop = null; 
        this.hp = 3;
        
        // ESTADOS: 'waiting', 'intro', 'moving_to_start', 'path_loop', 'repositioning', 'dead'
        this.state = 'waiting'; 
        
        // VELOCIDAD: Misma para todo
        this.moveSpeed = 6.0; 
        
        this.targetNodeIndex = 17; // Nodo de inicio y reset
        this.loopStartT = 0; 
        
        this.currentRoll = 0; 
        this.velocity = new THREE.Vector3(); 
        this.bounceY = 0;
        this.bounceVelocity = 0;
        
        this.lasers = [];
        this.shootTimer = 0;
        this.shootInterval = 3.5;

        this.dummyRotator = new THREE.Object3D();

        if (this.pathPoints.length > 0) {
            console.log("Enemigo iniciado con path de", this.pathPoints.length, "puntos");
            this.curve = new THREE.CatmullRomCurve3(this.pathPoints);
            this.calculateLoopStartT();
        } else {
            console.warn("Enemigo iniciado SIN PATH");
        }

        this.loadModel();
    }

    calculateLoopStartT() {
        if (this.pathPoints.length < 2) return;

        // Intentamos usar el índice 17. 
        // Si no hay suficientes puntos (ej: la curva tiene 10), usamos EL ÚLTIMO en vez del primero.
        // Esto evita que vuelva al principio (escaleras).
        if (this.pathPoints.length > this.targetNodeIndex) {
             this.safeTargetIndex = this.targetNodeIndex;
        } else {
             console.log("Aviso: Pocos puntos en curva. Usando el final como loop.");
             this.safeTargetIndex = this.pathPoints.length - 1;
        }

        this.loopStartT = this.safeTargetIndex / (this.pathPoints.length - 1);
    }

    loadModel() {
        const loader = new GLTFLoader();
        loader.load('./assets/models/mascara_alada.gltf', (gltf) => {
            this.mesh = gltf.scene;
            this.scene.add(this.mesh);
            this.mesh.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    if (child.name.toLowerCase().includes('top')) {
                        this.collisionTop = child;
                        child.visible = false; 
                    }
                }
            });
            if(this.refObject) {
                this.refObject.updateMatrixWorld();
                this.mesh.position.copy(this.refObject.position);
                this.mesh.quaternion.copy(this.refObject.quaternion);
            }
        });
    }

    startIntro() {
        if(this.state !== 'waiting') return;
        this.state = 'intro';
        console.log("Enemigo: Start Intro");

        if (this.sceneMixer && this.introClip) {
            const action = this.sceneMixer.clipAction(this.introClip);
            action.loop = THREE.LoopOnce;
            action.clampWhenFinished = true;
            action.reset().play();
            setTimeout(() => {
                if (this.state === 'intro') {
                    this.state = 'moving_to_start';
                }
            }, this.introClip.duration * 1000);
        } else {
            this.state = 'moving_to_start';
        }
    }

    update(dt, playerContainer) {
        if (this.state === 'dead') return;
        if (!this.mesh) return;

        if (this.state === 'waiting') {
            if(this.refObject) {
                this.mesh.position.copy(this.refObject.position);
                this.mesh.quaternion.copy(this.refObject.quaternion);
            }
        }
        else if (this.state === 'intro') {
            if(this.refObject) {
                this.refObject.updateMatrixWorld();
                this.mesh.position.setFromMatrixPosition(this.refObject.matrixWorld);
                this.mesh.quaternion.setFromRotationMatrix(this.refObject.matrixWorld);
            }
        }
        else if (this.state === 'moving_to_start') {
            if (this.pathPoints.length > 0) {
                const startPoint = this.pathPoints[this.safeTargetIndex];
                this.moveToPoint(dt, startPoint, () => {
                    this.state = 'path_loop';
                    this.pathT = this.loopStartT; 
                });
            } else {
                this.state = 'path_loop'; 
            }
        }
        else if (this.state === 'path_loop') {
            if (this.curve) {
                const totalLen = this.curve.getLength();
                this.pathT += (this.moveSpeed / totalLen) * dt;

                if (this.pathT >= 1.0) {
                    this.pathT = 1.0;
                    this.state = 'repositioning';
                }
                
                const point = this.curve.getPointAt(this.pathT);
                this.mesh.position.copy(point);
                
                const tangent = this.curve.getTangentAt(this.pathT).normalize();
                const lookTarget = point.clone().add(tangent);
                this.mesh.lookAt(lookTarget);
                
                const futureT = Math.min(1.0, this.pathT + 0.02);
                const futureTangent = this.curve.getTangentAt(futureT).normalize();
                const crossY = tangent.clone().cross(futureTangent).y;
                
                const tiltIntensity = 8.0; 
                let targetRoll = -crossY * tiltIntensity;
                targetRoll = Math.max(-0.5, Math.min(0.5, targetRoll)); 

                this.currentRoll = THREE.MathUtils.lerp(this.currentRoll, targetRoll, dt * 2.0);
                const qRoll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.currentRoll);
                this.mesh.quaternion.multiply(qRoll);

                this.velocity.copy(tangent).multiplyScalar(this.moveSpeed);
            }
        }
        else if (this.state === 'repositioning') {
            if (this.pathPoints.length > 0) {
                const loopPoint = this.pathPoints[this.safeTargetIndex];
                this.moveToPoint(dt, loopPoint, () => {
                    this.state = 'path_loop';
                    this.pathT = this.loopStartT; 
                });
            } else {
                this.state = 'path_loop';
                this.pathT = 0;
            }
        }

        const tension = 150.0; const damping = 10.0;
        const acceleration = -tension * this.bounceY - damping * this.bounceVelocity;
        this.bounceVelocity += acceleration * dt;
        this.bounceY += this.bounceVelocity * dt;
        this.mesh.position.y += this.bounceY;

        if (['moving_to_start', 'path_loop', 'repositioning'].includes(this.state)) {
            this.shootTimer += dt;
            if (this.shootTimer > this.shootInterval) {
                this.shootLasers();
                this.shootTimer = 0;
            }
        }
        
        this.updateLasers(dt, playerContainer);
    }

    moveToPoint(dt, targetPos, onArrive) {
        const dist = this.mesh.position.distanceTo(targetPos);
        const dir = new THREE.Vector3().subVectors(targetPos, this.mesh.position).normalize();
        
        const step = this.moveSpeed * dt;
        
        if (dist <= step) {
            this.mesh.position.copy(targetPos);
            if (onArrive) onArrive();
        } else {
            this.mesh.position.addScaledVector(dir, step);
        }

        this.dummyRotator.position.copy(this.mesh.position);
        this.dummyRotator.lookAt(targetPos);
        this.mesh.quaternion.slerp(this.dummyRotator.quaternion, 5.0 * dt);
        
        this.currentRoll = THREE.MathUtils.lerp(this.currentRoll, 0, dt * 5.0);
        this.velocity.copy(dir).multiplyScalar(this.moveSpeed);
    }

    shootLasers() {
        const offsets = [-0.6, 0.6];
        offsets.forEach(xOff => {
            const geometry = new THREE.BoxGeometry(0.06, 0.06, 6.0); 
            const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
            const laser = new THREE.Mesh(geometry, material);
            laser.position.copy(this.mesh.position);
            laser.position.y += 0.2; 
            laser.quaternion.copy(this.mesh.quaternion);
            laser.translateX(xOff); laser.translateZ(2.5); 
            this.scene.add(laser);
            const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
            this.lasers.push({ mesh: laser, dir: dir, life: 1.5 }); 
        });
    }

    updateLasers(dt, playerContainer) {
        for (let i = this.lasers.length - 1; i >= 0; i--) {
            const l = this.lasers[i];
            l.life -= dt;
            const speed = 30.0; 
            l.mesh.position.addScaledVector(l.dir, speed * dt);
            if (playerContainer) {
                const dist = l.mesh.position.distanceTo(playerContainer.position);
                if (dist < 1.0) { takeDamage(); l.life = -1; }
            }
            if (l.life <= 0) {
                this.scene.remove(l.mesh);
                l.mesh.geometry.dispose(); l.mesh.material.dispose();
                this.lasers.splice(i, 1);
            }
        }
    }

    takeDamage() {
        if (this.state === 'dead') return;
        this.hp--;
        this.bounceVelocity = -6.0; 
        this.mesh.traverse(child => {
            if (child.isMesh && child.material) {
                const oldColor = child.material.color.clone();
                child.material.color.set(0xff0000);
                setTimeout(() => { if(child.material) child.material.color.copy(oldColor); }, 150);
            }
        });
        if (this.hp <= 0) this.die();
    }

    die() {
        this.state = 'dead';
        this.scene.remove(this.mesh);
        this.lasers.forEach(l => this.scene.remove(l.mesh));
        this.lasers = [];
        console.log("Enemigo derrotado");
    }
}