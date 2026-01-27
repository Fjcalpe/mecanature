import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { playerState, takeDamage } from './player.js';

export class Enemy {
    constructor(scene, playerContainer, flightArea) {
        this.scene = scene;
        this.playerContainer = playerContainer;
        
        this.mesh = null;
        this.collisionTop = null; 
        this.hp = 3;
        this.state = 'alive';
        
        // --- CONFIGURACIÓN DE VUELO ---
        this.maxSpeed = 3.5;      // Velocidad suave
        this.turnSpeed = 1.5;     // Giro lento
        this.arrivalRadius = 10.0; // Cambiar de objetivo con mucha antelación para curvas amplias
        
        this.velocity = new THREE.Vector3(1, 0, 0); 
        this.target = new THREE.Vector3();
        
        // Límites
        this.bounds = { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };
        this.calculateBounds(flightArea); 

        // Inicializar primer objetivo
        this.pickNewTarget();

        // FÍSICA DE REBOTE (Visual)
        this.bounceY = 0;         
        this.bounceVelocity = 0;  
        
        // LÁSERES
        this.lasers = [];
        this.shootTimer = 0;
        this.shootInterval = 5.0; 

        this.time = 0;
        this.loadModel();
    }

    calculateBounds(flightArea) {
        if (!flightArea) {
            this.position = new THREE.Vector3(0, 5, 0); 
            return;
        }
        
        if (!flightArea.geometry.boundingBox) flightArea.geometry.computeBoundingBox();
        const box = flightArea.geometry.boundingBox.clone();
        box.applyMatrix4(flightArea.matrixWorld);
        
        const padding = 5.0; 
        this.bounds = { 
            minX: box.min.x + padding, 
            maxX: box.max.x - padding, 
            minZ: box.min.z + padding, 
            maxZ: box.max.z - padding 
        };

        const centerX = (this.bounds.minX + this.bounds.maxX) / 2;
        const centerZ = (this.bounds.minZ + this.bounds.maxZ) / 2;
        this.position = new THREE.Vector3(centerX, 2.0, centerZ);
    }

    pickNewTarget() {
        // Buscamos un punto que esté AL FRENTE para evitar giros bruscos
        let bestTarget = null;
        
        // Intentamos 15 veces encontrar un punto bueno
        for(let i=0; i<15; i++) {
            const candidate = new THREE.Vector3(
                this.bounds.minX + Math.random() * (this.bounds.maxX - this.bounds.minX),
                1.5 + Math.random() * 2.0, // Altura 1.5 - 3.5
                this.bounds.minZ + Math.random() * (this.bounds.maxZ - this.bounds.minZ)
            );

            // Vector hacia el candidato
            const toCandidate = new THREE.Vector3().subVectors(candidate, this.position);
            const dist = toCandidate.length();
            toCandidate.normalize();
            
            // Dirección actual
            const currentDir = this.velocity.clone().normalize();
            
            // Producto punto: > 0 significa que está delante (menos de 90 grados)
            // > 0.5 significa que está en un cono de 60 grados al frente (curva suave)
            const dot = currentDir.dot(toCandidate);

            // Queremos: Lejos (> 15m) Y Enfrente (> -0.2 para permitir giros suaves pero no 180º)
            if (dist > 15.0 && dot > -0.2) {
                this.target.copy(candidate);
                return;
            }
        }

        // Fallback: Si no encontramos nada bueno, un punto aleatorio lejos
        this.target.set(
            this.bounds.minX + Math.random() * (this.bounds.maxX - this.bounds.minX),
            2.0,
            this.bounds.minZ + Math.random() * (this.bounds.maxZ - this.bounds.minZ)
        );
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
            
            this.mesh.position.copy(this.position);
        });
    }

    update(dt, elapsedTime) {
        if (this.state === 'dead') return;
        
        if (this.mesh) {
            this.time = elapsedTime;

            // --- 1. MOVIMIENTO (STEERING) ---
            const distToTarget = this.mesh.position.distanceTo(this.target);

            // Si estamos llegando, buscar nuevo objetivo YA para no detenerse
            if (distToTarget < this.arrivalRadius) {
                this.pickNewTarget();
            }

            // Vector deseado
            const desired = new THREE.Vector3()
                .subVectors(this.target, this.mesh.position)
                .normalize()
                .multiplyScalar(this.maxSpeed);

            // Fuerza de giro (Steering Force)
            // Limitamos cuánto puede cambiar la velocidad por frame para que gire suave
            const steer = new THREE.Vector3().subVectors(desired, this.velocity);
            
            // Clamp de fuerza de giro (Esto define el radio de giro)
            const maxForce = 2.0; 
            if (steer.length() > maxForce) steer.normalize().multiplyScalar(maxForce);

            // Aplicar fuerza a la velocidad (Inercia)
            // velocity = velocity + steer * dt
            this.velocity.addScaledVector(steer, dt);

            // Asegurar velocidad máxima constante
            this.velocity.normalize().multiplyScalar(this.maxSpeed);

            // Mover
            this.mesh.position.addScaledVector(this.velocity, dt);

            // Clamp de Altura Suave
            if (this.mesh.position.y < 1.0) this.mesh.position.y += (1.0 - this.mesh.position.y) * 0.05;
            if (this.mesh.position.y > 3.5) this.mesh.position.y += (3.5 - this.mesh.position.y) * 0.05;

            // Guardar posición lógica
            this.position.copy(this.mesh.position);


            // --- 2. ROTACIÓN ESTABLE (SIN VIBRACIÓN) ---
            if (this.velocity.lengthSq() > 0.1) {
                // Dirección (Yaw)
                const angleY = Math.atan2(this.velocity.x, this.velocity.z);
                const targetQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angleY);

                // Banking (Inclinación Z)
                const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
                const velDir = this.velocity.clone().normalize();
                const turnFactor = forward.cross(velDir).y; 
                
                const targetBank = THREE.MathUtils.clamp(turnFactor * 2.0, -0.3, 0.3); // Inclinación suave
                const bankQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), targetBank);
                
                targetQ.multiply(bankQ);

                // Slerp suave
                this.mesh.quaternion.slerp(targetQ, 3.0 * dt);
            }

            // --- 3. REBOTE VISUAL ---
            const tension = 150.0; const damping = 10.0;
            const acceleration = -tension * this.bounceY - damping * this.bounceVelocity;
            this.bounceVelocity += acceleration * dt;
            this.bounceY += this.bounceVelocity * dt;
            
            this.mesh.position.y += this.bounceY;

            // --- 4. DISPARO ---
            this.shootTimer += dt;
            if (this.shootTimer > this.shootInterval) {
                this.shootLasers();
                this.shootTimer = 0;
            }
        }

        this.updateLasers(dt);
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
            
            laser.translateX(xOff);
            laser.translateZ(2.5); 

            this.scene.add(laser);
            
            const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
            this.lasers.push({ mesh: laser, dir: dir, life: 1.5 }); 
        });
    }

    updateLasers(dt) {
        for (let i = this.lasers.length - 1; i >= 0; i--) {
            const l = this.lasers[i];
            l.life -= dt;
            const speed = 30.0; 
            l.mesh.position.addScaledVector(l.dir, speed * dt);
            
            if (this.playerContainer) {
                const dist = l.mesh.position.distanceTo(this.playerContainer.position);
                if (dist < 1.0) {
                    takeDamage(); 
                    l.life = -1; 
                }
            }

            if (l.life <= 0) {
                this.scene.remove(l.mesh);
                l.mesh.geometry.dispose();
                l.mesh.material.dispose();
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