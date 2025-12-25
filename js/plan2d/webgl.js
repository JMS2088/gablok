// Experimental WebGL acceleration for wall rendering (prototype)
// Press 'G' to toggle. Falls back to 2D canvas if context fails.
(function(){
  if(window.plan2dEnableWebGL) return;
  var glState = { enabled:false, gl:null, program:null, attrPos:null, uScale:null, uPan:null, buffer:null };
  function compile(gl, type, src){ var s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){ console.error('GL shader error', gl.getShaderInfoLog(s)); return null; } return s; }
  function initGL(){ try{ var c=document.getElementById('plan2d-canvas'); if(!c) return false; var gl=c.getContext('webgl',{antialias:false,preserveDrawingBuffer:false}); if(!gl) return false; glState.gl=gl; var vs=compile(gl, gl.VERTEX_SHADER, "attribute vec2 aPos; uniform float uScale; uniform vec2 uPan; uniform vec2 uCanvas; void main(){ vec2 world = aPos; vec2 screen; screen.x = (uCanvas.x*0.5) + (uPan.x + world.x)*uScale; screen.y = (uCanvas.y*0.5) - (uPan.y + world.y)*uScale; gl_Position = vec4((screen.x/uCanvas.x)*2.0-1.0, (screen.y/uCanvas.y)*2.0-1.0, 0.0, 1.0); }" ); var fs=compile(gl, gl.FRAGMENT_SHADER, "precision mediump float; void main(){ gl_FragColor = vec4(0.90,0.92,0.95,1.0); }" ); if(!vs||!fs) return false; var prog=gl.createProgram(); gl.attachShader(prog,vs); gl.attachShader(prog,fs); gl.linkProgram(prog); if(!gl.getProgramParameter(prog,gl.LINK_STATUS)){ console.error('GL link error', gl.getProgramInfoLog(prog)); return false; } gl.useProgram(prog); glState.program=prog; glState.attrPos=gl.getAttribLocation(prog,'aPos'); glState.uScale=gl.getUniformLocation(prog,'uScale'); glState.uPan=gl.getUniformLocation(prog,'uPan'); glState.buffer=gl.createBuffer(); glState.uCanvas=gl.getUniformLocation(prog,'uCanvas'); return true; }catch(e){ console.warn('WebGL init failed',e); return false; }
  }
  function buildGeometry(){ var els=__plan2d.elements||[]; var verts=[]; for(var i=0;i<els.length;i++){ var w=els[i]; if(!w||w.type!=='wall') continue; var x0=w.x0,y0=w.y0,x1=w.x1,y1=w.y1; var dx=x1-x0, dy=y1-y0; var len=Math.hypot(dx,dy)||1; var thick=(w.thickness||__plan2d.wallThicknessM); var nx=-dy/len, ny=dx/len; var hx=nx*thick*0.5, hy=ny*thick*0.5; // quad two triangles
    verts.push(x0+hx, y0+hy, x1+hx, y1+hy, x1-hx, y1-hy); verts.push(x0+hx, y0+hy, x1-hx, y1-hy, x0-hx, y0-hy); }
    return new Float32Array(verts);
  }
  function drawGL(){ var gl=glState.gl; if(!gl) return; var c=document.getElementById('plan2d-canvas'); gl.viewport(0,0,c.width,c.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); var geom=buildGeometry(); gl.bindBuffer(gl.ARRAY_BUFFER, glState.buffer); gl.bufferData(gl.ARRAY_BUFFER, geom, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(glState.attrPos); gl.vertexAttribPointer(glState.attrPos,2,gl.FLOAT,false,0,0); gl.useProgram(glState.program); gl.uniform1f(glState.uScale,__plan2d.scale); gl.uniform2f(glState.uPan,__plan2d.panX,__plan2d.panY); gl.uniform2f(glState.uCanvas,c.width,c.height); gl.drawArrays(gl.TRIANGLES,0, geom.length/2); }
  window.plan2dEnableWebGL = function(on){ if(on && !glState.gl){ if(!initGL()){ console.warn('WebGL unavailable, keeping 2D canvas'); glState.enabled=false; return; } } glState.enabled=!!on; plan2dDraw(); };
  // Hook into existing draw to overlay GL walls when enabled
  var origDraw = window.plan2dDraw;
  if(typeof origDraw==='function'){
    window.plan2dDraw = function(){ origDraw(); if(glState.enabled){ try{ drawGL(); }catch(e){ console.warn('WebGL draw failed',e); glState.enabled=false; } } };
  }
  // Keyboard toggle: 'G'
  document.addEventListener('keydown', function(ev){ if(!__plan2d.active) return; if(ev.key==='g'||ev.key==='G'){ plan2dEnableWebGL(!glState.enabled); ev.preventDefault(); ev.stopPropagation(); } });
})();
