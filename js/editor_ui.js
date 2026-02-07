import * as THREE from 'three';

export class InGameEditor {
    constructor(scene, camera, renderer, orbs) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.orbs = orbs; 
        this.visible = false;
        
        this.currentLayerIndex = 0;
        this.isDraggingOrb = false;
        this.dragPlane = new THREE.Plane();
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.selectedOrb = null;
        
        this.injectStyles();
        this.createUI();
        
        if(this.orbs.length > 0) this.syncUI();

        this.renderer.domElement.addEventListener('pointerdown', (e) => this.onMouseDown(e));
        this.renderer.domElement.addEventListener('pointermove', (e) => this.onMouseMove(e));
        this.renderer.domElement.addEventListener('pointerup', () => this.onMouseUp());
    }

    injectStyles() {
        const style = document.createElement('style');
        style.innerHTML = `
            #pe-toggle { 
                position: fixed; top: 10px; right: 120px; z-index: 1000; 
                background: #e91e63; color: white; border: none; padding: 8px 15px; 
                border-radius: 4px; cursor: pointer; font-weight: bold; font-family: monospace; 
                box-shadow: 0 2px 5px rgba(0,0,0,0.5);
            }
            #pe-panel { 
                position: fixed; top: 0; right: 0; width: 340px; height: 100vh; 
                background: rgba(20, 20, 20, 0.95); border-left: 1px solid #444; 
                z-index: 2000; display: none; flex-direction: column; 
                color: #ccc; font-family: 'Segoe UI', sans-serif; font-size: 11px;
                backdrop-filter: blur(10px); box-shadow: -5px 0 15px rgba(0,0,0,0.5);
            }
            #pe-content { flex: 1; overflow-y: auto; padding: 15px; scrollbar-width: thin; }
            .pe-group { margin-bottom: 12px; background: rgba(255,255,255,0.03); padding: 8px; border-radius: 4px; border: 1px solid #333; }
            .pe-label { display: block; color: #e91e63; font-weight: 800; margin-bottom: 8px; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
            .pe-row { display: flex; align-items: center; margin-bottom: 5px; gap: 8px; }
            .pe-row label { flex: 1; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .pe-row input[type=range] { flex: 2; cursor: pointer; accent-color: #e91e63; height: 4px; }
            .pe-row input[type=number] { width: 45px; background: #111; border: 1px solid #444; color: #00e5ff; text-align: right; padding: 2px; border-radius: 2px; }
            .pe-row select { flex: 2; background: #222; color: white; border: 1px solid #444; padding: 2px; }
            .pe-row input[type=color] { border: none; width: 30px; height: 20px; background: none; cursor: pointer; }
            .pe-btn-bar { padding: 10px; border-top: 1px solid #444; display: flex; gap: 5px; background: #1a1a1a; }
            .pe-btn { flex: 1; padding: 8px; border: none; border-radius: 3px; cursor: pointer; color: white; font-weight: bold; font-size: 10px; text-transform: uppercase; transition: filter 0.2s; }
            .pe-btn:hover { filter: brightness(1.2); }
            .pe-save { background: #2e7d32; } .pe-load { background: #1565c0; } .pe-reset { background: #c62828; }
            .layer-ctrl { display: flex; gap: 5px; margin-bottom: 10px; background: #333; padding: 5px; border-radius: 4px; }
            .layer-select { flex: 1; background: #111; color: white; border: 1px solid #555; }
            .layer-btn { width: 30px; background: #444; color: white; border: none; cursor: pointer; font-weight: bold; }
            .layer-btn:hover { background: #666; }
            .layer-btn.add { color: #00e676; } .layer-btn.del { color: #ff1744; }
        `;
        document.head.appendChild(style);
    }

    createUI() {
        const btn = document.createElement('button');
        btn.id = 'pe-toggle'; btn.innerText = '✨ EDITOR';
        btn.onclick = () => this.toggleEditor();
        document.body.appendChild(btn);

        const panel = document.createElement('div');
        panel.id = 'pe-panel';
        
        ['pointerdown', 'pointerup', 'pointermove', 'touchstart', 'touchend', 'touchmove', 'mousedown', 'mouseup', 'mousemove'].forEach(evt => {
            panel.addEventListener(evt, (e) => e.stopPropagation());
        });

        const content = document.createElement('div');
        content.id = 'pe-content';
        this.ui = {};

        // GESTOR DE CAPAS
        const layerGroup = document.createElement('div');
        layerGroup.className = 'pe-group';
        layerGroup.innerHTML = `<span class="pe-label">Capas de Partículas</span>`;
        const layerCtrl = document.createElement('div');
        layerCtrl.className = 'layer-ctrl';
        
        this.layerSelect = document.createElement('select');
        this.layerSelect.className = 'layer-select';
        this.layerSelect.onchange = () => {
            this.currentLayerIndex = parseInt(this.layerSelect.value);
            this.syncUI();
        };

        const btnAdd = document.createElement('button');
        btnAdd.className = 'layer-btn add'; btnAdd.innerText = '+';
        btnAdd.onclick = () => this.addLayer();

        const btnDel = document.createElement('button');
        btnDel.className = 'layer-btn del'; btnDel.innerText = '-';
        btnDel.onclick = () => this.removeLayer();

        layerCtrl.append(this.layerSelect, btnAdd, btnDel);
        layerGroup.appendChild(layerCtrl);
        content.appendChild(layerGroup);

        // SECCIONES UI
        content.appendChild(this.createGroup('Esfera & Luz', [
            { type: 'range', id: 'orbRadius', label: 'Radio Orbe', min: 0.1, max: 2, step: 0.1 },
            { type: 'color', id: 'orbColor', label: 'Color Orbe' },
            { type: 'select', id: 'orbBlend', label: 'Mezcla Orbe', options: ['Normal', 'Additive'] },
            { type: 'color', id: 'lightColor', label: 'Color Luz' },
            { type: 'range', id: 'lightInt', label: 'Intensidad', min: 0, max: 20, step: 0.1 }
        ]));

        content.appendChild(this.createGroup('Capa: Apariencia', [
            { type: 'select', id: 'genType', label: 'Forma', options: ['glow','hardCircle','smoke','image'] },
            { type: 'color', id: 'genColor', label: 'Tinte' },
            { type: 'select', id: 'blendMode', label: 'Blending', options: ['add','normal'] },
            { type: 'file', id: 'imageSrc', label: 'Textura PNG' }
        ]));

        content.appendChild(this.createGroup('Capa: Emisión', [
            { type: 'range', id: 'emissionRate', label: 'Cantidad/s', min: 1, max: 500, step: 1 },
            { type: 'range', id: 'spawnRadius', label: 'Radio Spawn', min: 0, max: 2, step: 0.1 }
        ]));

        content.appendChild(this.createGroup('Capa: Física', [
            { type: 'range', id: 'speedVal', label: 'Velocidad', min: 0, max: 10, step: 0.1 },
            { type: 'range', id: 'speedRnd', label: 'Aleatorio', min: 0, max: 5, step: 0.1 },
            { type: 'range', id: 'gravityY', label: 'Gravedad Y', min: -10, max: 10, step: 0.1 },
            { type: 'range', id: 'lifeMin', label: 'Vida Min', min: 0.1, max: 5, step: 0.1 },
            { type: 'range', id: 'lifeMax', label: 'Vida Max', min: 0.1, max: 5, step: 0.1 }
        ]));

        content.appendChild(this.createGroup('Capa: Evolución', [
            { type: 'range', id: 'scaleStart', label: 'Escala Ini', min: 0, max: 3, step: 0.1 },
            { type: 'range', id: 'scaleEnd', label: 'Escala Fin', min: 0, max: 3, step: 0.1 },
            { type: 'range', id: 'alphaStart', label: 'Alpha Ini', min: 0, max: 1, step: 0.05 },
            { type: 'range', id: 'alphaEnd', label: 'Alpha Fin', min: 0, max: 1, step: 0.05 },
            { type: 'range', id: 'globalOpacity', label: 'Opacidad', min: 0, max: 1, step: 0.05 }
        ]));

        panel.appendChild(content);

        const footer = document.createElement('div');
        footer.className = 'pe-btn-bar';
        
        const btnReset = document.createElement('button');
        btnReset.className = 'pe-btn pe-reset'; btnReset.innerText = 'RESET POS';
        btnReset.onclick = () => this.resetOrbPosition();

        const btnSave = document.createElement('button');
        btnSave.className = 'pe-btn pe-save'; btnSave.innerText = 'GUARDAR';
        btnSave.onclick = () => this.exportJSON();

        const btnLoad = document.createElement('button');
        btnLoad.className = 'pe-btn pe-load'; btnLoad.innerText = 'CARGAR';
        btnLoad.onclick = () => inpFile.click();

        const inpFile = document.createElement('input');
        inpFile.type = 'file'; inpFile.accept = '.json'; inpFile.style.display = 'none';
        inpFile.onchange = (e) => this.importJSON(e);

        footer.append(btnReset, btnLoad, btnSave);
        panel.appendChild(footer);
        panel.appendChild(inpFile);

        document.body.appendChild(panel);
    }

    createGroup(title, controls) {
        const group = document.createElement('div');
        group.className = 'pe-group';
        group.innerHTML = `<span class="pe-label">${title}</span>`;
        controls.forEach(c => {
            const row = document.createElement('div');
            row.className = 'pe-row';
            if (c.type === 'range') {
                row.innerHTML = `<label>${c.label}</label>`;
                const input = document.createElement('input');
                input.type = 'range'; input.min = c.min; input.max = c.max; input.step = c.step;
                const num = document.createElement('input');
                num.type = 'number'; num.step = c.step;
                const update = () => {
                    const val = parseFloat(input.value);
                    num.value = val;
                    this.updateValues(c.id, val);
                };
                input.oninput = update;
                num.onchange = () => { input.value = num.value; update(); };
                this.ui[c.id] = { input, num };
                row.append(input, num);
            } else if (c.type === 'select') {
                row.innerHTML = `<label>${c.label}</label>`;
                const sel = document.createElement('select');
                c.options.forEach(o => sel.innerHTML += `<option value="${o}">${o}</option>`);
                sel.onchange = () => this.updateValues(c.id, sel.value);
                this.ui[c.id] = { input: sel };
                row.appendChild(sel);
            } else if (c.type === 'color') {
                row.innerHTML = `<label>${c.label}</label>`;
                const col = document.createElement('input'); col.type = 'color';
                col.oninput = () => this.updateValues(c.id, col.value);
                this.ui[c.id] = { input: col };
                row.appendChild(col);
            } else if (c.type === 'file') {
                const btn = document.createElement('button');
                btn.innerText = '📁 PNG'; btn.className = 'pe-btn pe-load';
                const file = document.createElement('input');
                file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
                btn.onclick = () => file.click();
                file.onchange = (e) => {
                    const f = e.target.files[0]; if(!f) return;
                    const r = new FileReader();
                    r.onload = (evt) => {
                        this.orbs.forEach(orb => {
                            const layer = orb.particles.layers[this.currentLayerIndex];
                            if(layer) {
                                layer.updateConfig({
                                    sourceType: 'image',
                                    genType: 'image',
                                    imageSrc: evt.target.result
                                });
                            }
                        });
                        this.syncUI();
                    };
                    r.readAsDataURL(f);
                };
                row.append(btn, file);
            }
            group.appendChild(row);
        });
        return group;
    }

    refreshLayerList() {
        if(this.orbs.length === 0) return;
        const orb = this.orbs[0];
        const layers = orb.particles.layers;
        
        this.layerSelect.innerHTML = '';
        layers.forEach((l, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            const typeLabel = l.config.sourceType === 'image' ? 'PNG' : l.config.genType;
            opt.innerText = `Capa ${i + 1} (${typeLabel})`;
            this.layerSelect.appendChild(opt);
        });
        
        if (this.currentLayerIndex >= layers.length) this.currentLayerIndex = layers.length - 1;
        if (this.currentLayerIndex < 0 && layers.length > 0) this.currentLayerIndex = 0;
        this.layerSelect.value = this.currentLayerIndex;
    }

    addLayer() {
        this.orbs.forEach(orb => {
            orb.particles.addLayer({
                genType: 'glow', genColor: '#ff00ff', emissionRate: 10, speed: {value: 1, random: 0}
            });
        });
        this.currentLayerIndex = this.orbs[0].particles.layers.length - 1;
        this.syncUI();
    }

    removeLayer() {
        if(this.orbs[0].particles.layers.length <= 1) {
            alert("Debe haber al menos una capa.");
            return;
        }
        if(!confirm("¿Borrar capa actual?")) return;

        this.orbs.forEach(orb => {
            orb.particles.removeLayer(this.currentLayerIndex);
        });
        this.currentLayerIndex = Math.max(0, this.currentLayerIndex - 1);
        this.syncUI();
    }

    syncUI() {
        if(this.orbs.length === 0) return;
        const orb = this.orbs[0];
        const mesh = orb.mesh;
        const light = orb.light;

        this.refreshLayerList();
        
        const layer = orb.particles.layers[this.currentLayerIndex];
        const pCfg = layer ? layer.config : {};

        const setVal = (id, v) => {
            if(!this.ui[id]) return;
            this.ui[id].input.value = v;
            if(this.ui[id].num) this.ui[id].num.value = v;
        };

        setVal('orbRadius', mesh.geometry.parameters.radius);
        setVal('orbColor', '#' + mesh.material.color.getHexString());
        setVal('orbBlend', mesh.material.blending === THREE.AdditiveBlending ? 'Additive' : 'Normal');
        setVal('lightColor', '#' + light.color.getHexString());
        setVal('lightInt', light.intensity);

        if(layer) {
            const visualType = pCfg.sourceType === 'image' ? 'image' : pCfg.genType;
            setVal('genType', visualType);
            setVal('genColor', pCfg.genColor);
            setVal('blendMode', pCfg.blendMode || 'add');
            setVal('emissionRate', pCfg.emissionRate);
            setVal('spawnRadius', pCfg.spawnRadius);
            setVal('speedVal', pCfg.speed.value);
            setVal('speedRnd', pCfg.speed.random);
            setVal('gravityY', pCfg.gravity.y);
            setVal('lifeMin', pCfg.life.min);
            setVal('lifeMax', pCfg.life.max);
            setVal('scaleStart', pCfg.scale.start);
            setVal('scaleEnd', pCfg.scale.end);
            setVal('alphaStart', pCfg.alpha.start);
            setVal('alphaEnd', pCfg.alpha.end);
            setVal('globalOpacity', pCfg.globalOpacity);
        }
    }

    updateValues(id, val) {
        this.orbs.forEach(orb => {
            const layer = orb.particles.layers[this.currentLayerIndex];
            if(layer) {
                const updates = {};
                
                if(id === 'genType') {
                    if(val === 'image') {
                        updates.sourceType = 'image';
                        updates.genType = 'image';
                    } else {
                        updates.sourceType = 'generator';
                        updates.genType = val;
                    }
                }
                else if(id === 'speedVal') updates.speed = { value: val };
                else if(id === 'speedRnd') updates.speed = { random: val };
                else if(id === 'lifeMin') updates.life = { min: val };
                else if(id === 'lifeMax') updates.life = { max: val };
                else if(id === 'scaleStart') updates.scale = { start: val };
                else if(id === 'scaleEnd') updates.scale = { end: val };
                else if(id === 'alphaStart') updates.alpha = { start: val };
                else if(id === 'alphaEnd') updates.alpha = { end: val };
                else if(id === 'gravityY') updates.gravity = { y: val };
                else updates[id] = val;

                const pc = layer.config;
                if(updates.speed) updates.speed = { ...pc.speed, ...updates.speed };
                if(updates.life) updates.life = { ...pc.life, ...updates.life };
                if(updates.scale) updates.scale = { ...pc.scale, ...updates.scale };
                if(updates.alpha) updates.alpha = { ...pc.alpha, ...updates.alpha };
                if(updates.gravity) updates.gravity = { ...pc.gravity, ...updates.gravity };
                
                if(Object.keys(this.ui).some(k => k === id && !k.startsWith('orb') && !k.startsWith('light'))) {
                    layer.updateConfig(updates);
                }
            }

            if(id.startsWith('orb')) {
                const m = orb.mesh;
                if(id === 'orbRadius') {
                    m.geometry.dispose();
                    m.geometry = new THREE.SphereGeometry(val, 32, 32);
                }
                if(id === 'orbColor') m.material.color.set(val);
                if(id === 'orbBlend') {
                    m.material.blending = val === 'Additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
                    m.material.needsUpdate = true;
                }
            }

            if(id.startsWith('light')) {
                const l = orb.light;
                if(id === 'lightColor') l.color.set(val);
                if(id === 'lightInt') l.intensity = val;
            }
        });
    }

    toggleEditor() {
        this.visible = !this.visible;
        document.getElementById('pe-panel').style.display = this.visible ? 'flex' : 'none';
        if (this.visible && this.orbs.length > 0) {
            const orb = this.orbs[0];
            orb.state = 'editor_mode'; 
            this.resetOrbPosition();
            this.syncUI();
        } else {
            this.orbs.forEach(o => o.state = 'flying');
        }
    }

    resetOrbPosition() {
        if(this.orbs.length === 0) return;
        const targetPos = new THREE.Vector3(0, 0, -3).applyMatrix4(this.camera.matrixWorld);
        this.orbs.forEach((o, i) => {
            o.mesh.position.copy(targetPos);
            o.mesh.position.x += i * 1.5; 
            o.velocity.set(0,0,0);
        });
    }

    async exportJSON() {
        if(this.orbs.length === 0) return;
        const orb = this.orbs[0];
        const layersConfig = orb.particles.layers.map(l => l.config);

        const data = {
            layers: layersConfig,
            orb: {
                radius: orb.mesh.geometry.parameters.radius,
                color: '#' + orb.mesh.material.color.getHexString(),
                blend: orb.mesh.material.blending === THREE.AdditiveBlending ? 'Additive' : 'Normal'
            },
            light: {
                color: '#' + orb.light.color.getHexString(),
                intensity: orb.light.intensity
            }
        };
        
        const json = JSON.stringify(data, null, 2);

        // --- PREGUNTAR DÓNDE GUARDAR (CHROME/EDGE) ---
        try {
            if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName: 'orb_design_layers.json',
                    types: [{
                        description: 'JSON Files',
                        accept: { 'application/json': ['.json'] },
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(json);
                await writable.close();
            } else {
                // FALLBACK CLÁSICO (Firefox, etc)
                const blob = new Blob([json], {type: "application/json"});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = "orb_design_layers.json";
                a.click();
                URL.revokeObjectURL(url);
            }
        } catch (err) {
            // Usuario canceló
            if (err.name !== 'AbortError') console.error('Error al guardar:', err);
        }
    }

    importJSON(e) {
        const file = e.target.files[0]; if(!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = JSON.parse(evt.target.result);
                if(data.layers || data.particles) {
                    this.orbs.forEach(o => o.particles.importConfig(data));
                }
                if(data.orb) {
                    this.updateValues('orbRadius', data.orb.radius);
                    this.updateValues('orbColor', data.orb.color);
                    this.updateValues('orbBlend', data.orb.blend);
                }
                if(data.light) {
                    this.updateValues('lightColor', data.light.color);
                    this.updateValues('lightInt', data.light.intensity);
                }
                this.currentLayerIndex = 0;
                this.syncUI();
            } catch(err) { alert("Error JSON: " + err); }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    onMouseDown(e) {
        if(!this.visible) return;
        this.updateMouse(e);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.orbs.map(o => o.mesh));
        if(intersects.length > 0) {
            this.isDraggingOrb = true;
            this.selectedOrb = intersects[0].object; 
            this.dragPlane.setFromNormalAndCoplanarPoint(
                this.camera.getWorldDirection(new THREE.Vector3()),
                this.selectedOrb.position
            );
            e.preventDefault(); 
        }
    }

    onMouseMove(e) {
        if(!this.isDraggingOrb || !this.visible) return;
        this.updateMouse(e);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const target = new THREE.Vector3();
        if(this.raycaster.ray.intersectPlane(this.dragPlane, target)) {
            this.selectedOrb.position.copy(target);
        }
    }

    onMouseUp() {
        this.isDraggingOrb = false;
        this.selectedOrb = null;
    }

    updateMouse(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }
}