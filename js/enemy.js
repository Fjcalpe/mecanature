import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { takeDamage } from './player.js';
import { levelState } from './level.js';

export class Enemy {
    constructor(scene, config, onHitPlayerCallback) {
        this.scene = scene;
        this.refObject = config.refObject;
        this.pathPoints = config.pathPoints || [];
        this.sceneMixer = config.mixer; 
        this.introClip = config.introClip;
        this.onHitPlayerCallback = onHitPlayerCallback; 

        this.mesh = null;
        this.collisionTop = null; 
        this.hp = 3;
        
        this.state = 'waiting'; 
        
        this.moveSpeed = 6.0; 
        this.targetNodeIndex = 17; 
        this.loopStartT = 0; 
        
        this.currentRoll = 0; 
        this.velocity = new THREE.Vector3(); 
        this.bounceY = 0;
        this.bounceVelocity = 0;
        
        this.lasers = [];
        this.shootTimer = 0;
        this.shootInterval = 1.2;

        this.dummyRotator = new THREE.Object3D();

        // Variables temporales para evitar Garbage Collection en el bucle
        this._laserStart = new THREE.Vector3();
        this._laserEnd = new THREE.Vector3();
        this._line = new THREE.Line3();
        this._closestPoint = new THREE.Vector3();

        if (this.pathPoints.length > 0) {
            this.curve = new THREE.CatmullRomCurve3(this.pathPoints);
            this.calculateLoopStartT();
        }
        this.loadModel();
    }

    calculateLoopStartT() {
        if (this.pathPoints.length < 2) return;
        if (this.pathPoints.length > this.targetNodeIndex) {
             this.safeTargetIndex = this.targetNodeIndex;
        } else {
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
            // LÁSERES 36.0 de largo
            const geometry = new THREE.BoxGeometry(0.18, 0.18, 36.0); 
            const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
            const laser = new THREE.Mesh(geometry, material);
            
            laser.position.copy(this.mesh.position);
            laser.position.y += 0.2; 
            laser.quaternion.copy(this.mesh.quaternion);
            
            laser.translateX(xOff); 
            laser.translateZ(18.0); 

            this.scene.add(laser);
            
            const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
            this.lasers.push({ mesh: laser, dir: dir, life: 1.5 }); 
        });
    }

    updateLasers(dt, playerContainer) {
        const hitRadius = levelState.laserHitRadius; 
        // Longitud del láser 36.0, la mitad es 18.0
        const halfLength = 18.0;

        for (let i = this.lasers.length - 1; i >= 0; i--) {
            const l = this.lasers[i];
            l.life -= dt;
            const speed = 30.0; 
            l.mesh.position.addScaledVector(l.dir, speed * dt);
            
            if (playerContainer) {
                // SOLUCIÓN: Calcular colisión contra la línea completa del láser, no solo el centro.
                
                // 1. Definir el inicio y fin del láser en el espacio
                this._laserStart.copy(l.mesh.position).addScaledVector(l.dir, -halfLength);
                this._laserEnd.copy(l.mesh.position).addScaledVector(l.dir, halfLength);
                
                // 2. Crear segmento de línea y buscar el punto más cercano al jugador
                this._line.set(this._laserStart, this._laserEnd);
                this._line.closestPointToPoint(playerContainer.position, true, this._closestPoint);
                
                // 3. Medir distancia desde ese punto cercano al jugador
                const distToLine = this._closestPoint.distanceTo(playerContainer.position);

                if (distToLine < hitRadius) { 
                    takeDamage(); 
                    if(this.onHitPlayerCallback) {
                        this.onHitPlayerCallback();
                    }
                    l.life = -1; // Destruir láser al impactar
                }
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