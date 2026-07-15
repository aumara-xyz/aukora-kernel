// Aukora Spatial — raw WebGL2 renderer. Zero dependencies, two draw calls:
//   1. instanced edge ribbons (screen-space quads, endpoints fetched from the
//      position texture, wave pulse driven by a single u_waveTime uniform)
//   2. instanced node impostor spheres (billboard quads, sphere-shaded in the
//      fragment shader)
// Position-texture contract: RGBA32F, side = ceil(sqrt(n)), NEAREST filtering
// (Safari/ANGLE requirement), texel i at (i % side, i / side), xyz = world pos.
// See spatial/RENDERER.md for the full program I/O contract.

const NODE_VS = `#version 300 es
precision highp float;
precision highp int;
uniform mat4 u_vp;
uniform vec2 u_viewport;
uniform float u_pixFactor;
uniform highp sampler2D u_pos;
uniform int u_texW;
layout(location=0) in vec2 a_corner;
layout(location=1) in float a_index;
layout(location=2) in vec3 a_color;
layout(location=3) in float a_size;
layout(location=4) in float a_flag;
out vec2 v_uv;
out vec3 v_color;
flat out float v_flag;
void main() {
  int i = int(a_index + 0.5);
  vec3 p = texelFetch(u_pos, ivec2(i % u_texW, i / u_texW), 0).xyz;
  vec4 clip = u_vp * vec4(p, 1.0);
  if (clip.w <= 0.001) { gl_Position = vec4(2e6, 2e6, 2.0, 1.0); v_uv = vec2(0); v_color = vec3(0); v_flag = 0.0; return; }
  float sizePx = max(a_size * u_pixFactor / clip.w, 2.5);
  clip.xy += a_corner * sizePx * 2.0 / u_viewport * clip.w;
  gl_Position = clip;
  v_uv = a_corner;
  v_color = a_color;
  v_flag = a_flag;
}`;

const NODE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_color;
flat in float v_flag;
out vec4 outColor;
void main() {
  float r2 = dot(v_uv, v_uv);
  if (r2 > 1.0) discard;
  float z = sqrt(1.0 - r2);
  vec3 n = vec3(v_uv, z);
  vec3 light = normalize(vec3(0.35, 0.55, 0.8));
  float diff = 0.32 + 0.68 * max(dot(n, light), 0.0);
  float rim = pow(1.0 - z, 2.2);
  vec3 col = v_color * diff + v_color * rim * 0.7;
  float alpha = 1.0 - smoothstep(0.86, 1.0, sqrt(r2));
  if (v_flag > 3.5) { alpha *= 0.42; col *= 0.7; }          // dimmed (outside selection halo)
  else if (v_flag > 2.5) { col = mix(col, vec3(1.0), 0.12); } // neighbor
  else if (v_flag > 1.5) { col = mix(col, vec3(1.0), 0.30); alpha = 1.0; } // selected
  else if (v_flag > 0.5) { col = mix(col, vec3(1.0), 0.22); } // hovered
  outColor = vec4(col * alpha, alpha);
}`;

const EDGE_VS = `#version 300 es
precision highp float;
precision highp int;
uniform mat4 u_vp;
uniform vec2 u_viewport;
uniform float u_widthPx;
uniform highp sampler2D u_pos;
uniform int u_texW;
layout(location=0) in vec2 a_corner;   // (t, side)
layout(location=1) in vec2 a_pair;     // node indices (a, b)
layout(location=2) in vec2 a_wave;     // (bfs depth, orientation) — depth < 0 = no wave
out float v_t;
out float v_depth;
void main() {
  int ia = int(a_pair.x + 0.5);
  int ib = int(a_pair.y + 0.5);
  vec3 pa = texelFetch(u_pos, ivec2(ia % u_texW, ia / u_texW), 0).xyz;
  vec3 pb = texelFetch(u_pos, ivec2(ib % u_texW, ib / u_texW), 0).xyz;
  vec4 ca = u_vp * vec4(pa, 1.0);
  vec4 cb = u_vp * vec4(pb, 1.0);
  if (min(ca.w, cb.w) <= 0.001) { gl_Position = vec4(2e6, 2e6, 2.0, 1.0); v_t = 0.0; v_depth = -1.0; return; }
  vec2 sa = ca.xy / ca.w * u_viewport;
  vec2 sb = cb.xy / cb.w * u_viewport;
  vec2 dir = sb - sa;
  float len = max(length(dir), 0.0001);
  vec2 normal = vec2(-dir.y, dir.x) / len;
  vec4 clip = mix(ca, cb, a_corner.x);
  clip.xy += normal * a_corner.y * u_widthPx * 2.0 / u_viewport * clip.w;
  gl_Position = clip;
  v_t = a_wave.y >= 0.0 ? a_corner.x : 1.0 - a_corner.x;
  v_depth = a_wave.x;
}`;

const EDGE_FS = `#version 300 es
precision highp float;
uniform vec3 u_edgeColor;
uniform float u_waveOn;
uniform float u_waveTime;
uniform vec3 u_waveColor;
in float v_t;
in float v_depth;
out vec4 outColor;
void main() {
  vec3 rgb = u_edgeColor * 0.16;
  float a = 0.055;
  if (u_waveOn > 0.5 && v_depth >= 0.0) {
    float x = u_waveTime - (v_depth + v_t);
    float band = exp(-x * x * 7.0);
    float trail = x > 0.0 ? exp(-x * 0.9) * 0.30 : 0.0;
    float glow = band + trail;
    rgb += u_waveColor * glow * 1.3;
    a += glow * 0.45;
  }
  outColor = vec4(rgb, a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true });
  if (!gl) return null;

  const R = {
    gl,
    nodeCount: 0,
    edgeCount: 0,
    texW: 1,
    lost: false,
  };

  let nodeProg, edgeProg, nodeVAO, edgeVAO, posTex;
  let buffers = {};
  let graph = null; // retained for context-restore rebuild
  let lastPositions = null;
  let uniforms = {};

  function initGL() {
    nodeProg = program(gl, NODE_VS, NODE_FS);
    edgeProg = program(gl, EDGE_VS, EDGE_FS);
    uniforms = {
      node: {
        vp: gl.getUniformLocation(nodeProg, 'u_vp'),
        viewport: gl.getUniformLocation(nodeProg, 'u_viewport'),
        pixFactor: gl.getUniformLocation(nodeProg, 'u_pixFactor'),
        pos: gl.getUniformLocation(nodeProg, 'u_pos'),
        texW: gl.getUniformLocation(nodeProg, 'u_texW'),
      },
      edge: {
        vp: gl.getUniformLocation(edgeProg, 'u_vp'),
        viewport: gl.getUniformLocation(edgeProg, 'u_viewport'),
        widthPx: gl.getUniformLocation(edgeProg, 'u_widthPx'),
        pos: gl.getUniformLocation(edgeProg, 'u_pos'),
        texW: gl.getUniformLocation(edgeProg, 'u_texW'),
        edgeColor: gl.getUniformLocation(edgeProg, 'u_edgeColor'),
        waveOn: gl.getUniformLocation(edgeProg, 'u_waveOn'),
        waveTime: gl.getUniformLocation(edgeProg, 'u_waveTime'),
        waveColor: gl.getUniformLocation(edgeProg, 'u_waveColor'),
      },
    };
    if (graph) uploadGraph();
    if (lastPositions) R.updatePositions(lastPositions);
  }

  function uploadGraph() {
    const { count, colors, sizes, edges } = graph;
    R.nodeCount = count;
    R.edgeCount = edges.length / 2;
    R.texW = Math.max(1, Math.ceil(Math.sqrt(count)));

    posTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, posTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, R.texW, R.texW, 0, gl.RGBA, gl.FLOAT, null);

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const edgeQuad = new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]);
    const indices = new Float32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
    const flags = new Float32Array(count);
    const pairs = new Float32Array(edges.length);
    for (let i = 0; i < edges.length; i++) pairs[i] = edges[i];
    const waves = new Float32Array(R.edgeCount * 2);
    for (let e = 0; e < R.edgeCount; e++) { waves[e * 2] = -1; waves[e * 2 + 1] = 1; }

    function buf(data, usage = gl.STATIC_DRAW) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      return b;
    }
    buffers = {
      quad: buf(quad),
      edgeQuad: buf(edgeQuad),
      indices: buf(indices),
      colors: buf(colors),
      sizes: buf(sizes),
      flags: buf(flags, gl.DYNAMIC_DRAW),
      pairs: buf(pairs),
      waves: buf(waves, gl.DYNAMIC_DRAW),
    };

    nodeVAO = gl.createVertexArray();
    gl.bindVertexArray(nodeVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.indices);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.colors);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.sizes);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(3, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.flags);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(4, 1);

    edgeVAO = gl.createVertexArray();
    gl.bindVertexArray(edgeVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.edgeQuad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.pairs);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.waves);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  R.setGraph = (g) => {
    graph = g;
    uploadGraph();
  };

  R.updatePositions = (positions) => {
    lastPositions = positions;
    if (R.lost || !posTex) return;
    // pad xyz -> rgba texels
    const n = R.nodeCount;
    const texels = new Float32Array(R.texW * R.texW * 4);
    for (let i = 0; i < n; i++) {
      texels[i * 4] = positions[i * 3];
      texels[i * 4 + 1] = positions[i * 3 + 1];
      texels[i * 4 + 2] = positions[i * 3 + 2];
      texels[i * 4 + 3] = 1;
    }
    gl.bindTexture(gl.TEXTURE_2D, posTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, R.texW, R.texW, gl.RGBA, gl.FLOAT, texels);
  };

  R.setFlags = (flags) => {
    if (R.lost || !buffers.flags) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.flags);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, flags);
  };

  R.setWaveEdges = (waves) => {
    if (R.lost || !buffers.waves) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.waves);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, waves);
  };

  R.resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  R.frame = (vp, pixFactor, wave) => {
    if (R.lost) return;
    const w = canvas.width, h = canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, posTex);

    // nodes first (write depth), then edges (test only) — edges hide behind orbs
    gl.useProgram(nodeProg);
    gl.uniformMatrix4fv(uniforms.node.vp, false, vp);
    gl.uniform2f(uniforms.node.viewport, w, h);
    gl.uniform1f(uniforms.node.pixFactor, pixFactor);
    gl.uniform1i(uniforms.node.pos, 0);
    gl.uniform1i(uniforms.node.texW, R.texW);
    gl.depthMask(true);
    gl.bindVertexArray(nodeVAO);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, R.nodeCount);

    gl.useProgram(edgeProg);
    gl.uniformMatrix4fv(uniforms.edge.vp, false, vp);
    gl.uniform2f(uniforms.edge.viewport, w, h);
    gl.uniform1f(uniforms.edge.widthPx, 0.75 * Math.min(window.devicePixelRatio || 1, 2));
    gl.uniform1i(uniforms.edge.pos, 0);
    gl.uniform1i(uniforms.edge.texW, R.texW);
    gl.uniform3f(uniforms.edge.edgeColor, 0.55, 0.68, 1.0);
    gl.uniform1f(uniforms.edge.waveOn, wave.on ? 1 : 0);
    gl.uniform1f(uniforms.edge.waveTime, wave.time);
    gl.uniform3f(uniforms.edge.waveColor, wave.color[0], wave.color[1], wave.color[2]);
    gl.depthMask(false);
    gl.bindVertexArray(edgeVAO);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, R.edgeCount);
    gl.depthMask(true);
    gl.bindVertexArray(null);
  };

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    R.lost = true;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    R.lost = false;
    initGL();
    R.onRestored?.();
  });

  initGL();
  return R;
}
