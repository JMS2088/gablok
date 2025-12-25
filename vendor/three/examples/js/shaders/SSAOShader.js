( function () {

	/**
 * References:
 * http://john-chapman-graphics.blogspot.com/2013/01/ssao-tutorial.html
 * https://learnopengl.com/Advanced-Lighting/SSAO
 * https://github.com/McNopper/OpenGL/blob/master/Example28/shader/ssao.frag.glsl
 */

	const SSAOShader = {
		defines: {
			'PERSPECTIVE_CAMERA': 1,
			'KERNEL_SIZE': 32
		},
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'tNormal': {
				value: null
			},
			'tDepth': {
				value: null
			},
			'tNoise': {
				value: null
			},
			'kernel': {
				value: null
			},
			'cameraNear': {
				value: null
			},
			'cameraFar': {
				value: null
			},
			'resolution': {
				value: new THREE.Vector2()
			},
			'cameraProjectionMatrix': {
				value: new THREE.Matrix4()
			},
			'cameraInverseProjectionMatrix': {
				value: new THREE.Matrix4()
			},
			'kernelRadius': {
				value: 8
			},
			'minDistance': {
				value: 0.005
			},
			'maxDistance': {
				value: 0.05
			}
		},
		vertexShader: /* glsl */`

		varying vec2 vUv;

		void main() {

			vUv = uv;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader: /* glsl */`

		uniform sampler2D tDiffuse;
		uniform sampler2D tNormal;
		uniform sampler2D tDepth;
		uniform sampler2D tNoise;

		uniform vec3 kernel[ KERNEL_SIZE ];

		uniform vec2 resolution;

		uniform float cameraNear;
		uniform float cameraFar;
		uniform mat4 cameraProjectionMatrix;
		uniform mat4 cameraInverseProjectionMatrix;

		uniform float kernelRadius;
		uniform float minDistance; // avoid artifacts caused by neighbour fragments with minimal depth difference
		uniform float maxDistance; // avoid the influence of fragments which are too far away

		varying vec2 vUv;

		#include <packing>

		float getDepth( const in vec2 screenPosition ) {

			return texture2D( tDepth, screenPosition ).x;

		}
	const SSAOShader = {
		defines: {
			'KERNEL_SIZE': 32,
			'ORTHOGRAPHIC_CAMERA': 0,
			'PERSPECTIVE_CAMERA': 1
		},
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'tNormal': {
				value: null
			},
			'tDepth': {
				value: null
			},
			'tNoise': {
				value: null
			},
			'kernel': {
				value: null
			},
			'cameraNear': {
				value: null
			},
			'cameraFar': {
				value: null
			},
			'resolution': {
				value: new THREE.Vector2()
			},
			'cameraProjectionMatrix': {
				value: new THREE.Matrix4()
			},
			'cameraInverseProjectionMatrix': {
				value: new THREE.Matrix4()
			},
			'kernelRadius': {
				value: 8.0
			},
			'minDistance': {
				value: 0.005
			},
			'maxDistance': {
				value: 0.1
			}
		},
		vertexShader: `varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader: `#include <common>
		#include <packing>

		varying vec2 vUv;

		uniform sampler2D tDiffuse;
		uniform sampler2D tNormal;
		uniform sampler2D tDepth;
		uniform sampler2D tNoise;

		uniform vec2 resolution;

		uniform float cameraNear;
		uniform float cameraFar;

		uniform float kernelRadius;
		uniform float minDistance;
		uniform float maxDistance;

		uniform vec3 kernel[ KERNEL_SIZE ];

		uniform mat4 cameraProjectionMatrix;
		uniform mat4 cameraInverseProjectionMatrix;

		float getLinearDepth( const in vec2 screenPosition ) {

			#if PERSPECTIVE_CAMERA == 1

				float fragCoordZ = texture2D( tDepth, screenPosition ).x;
				float viewZ = perspectiveDepthToViewZ( fragCoordZ, cameraNear, cameraFar );
				return viewZToOrthographicDepth( viewZ, cameraNear, cameraFar );

			#else

				return texture2D( tDepth, screenPosition ).x;

			#endif

		}

		vec3 getViewPosition( const in vec2 screenPosition, const in float depth, const in float clipW ) {

			float clipX = screenPosition.x * 2.0 - 1.0;
			float clipY = screenPosition.y * 2.0 - 1.0;

			vec4 clipPosition = vec4( clipX, clipY, depth, 1.0 );
			clipPosition *= clipW;

			return ( cameraInverseProjectionMatrix * clipPosition ).xyz;

		}

		vec3 getViewNormal( const in vec2 screenPosition ) {

			vec3 normal = texture2D( tNormal, screenPosition ).xyz * 2.0 - 1.0;
			return normalize( normal );

		}

		void main() {

			float depth = texture2D( tDepth, vUv ).x;

			float viewZ = - perspectiveDepthToViewZ( depth, cameraNear, cameraFar );
			float clipW = cameraProjectionMatrix[2][3] * viewZ + cameraProjectionMatrix[3][3];

			vec3 viewPosition = getViewPosition( vUv, depth, clipW );
			vec3 viewNormal = getViewNormal( vUv );

			vec2 noiseScale = vec2( resolution.x / 4.0, resolution.y / 4.0 );
			vec3 random = vec3( texture2D( tNoise, vUv * noiseScale ).r );

			vec3 tangent = normalize( random - viewNormal * dot( random, viewNormal ) );
			vec3 bitangent = cross( viewNormal, tangent );
			mat3 kernelMatrix = mat3( tangent, bitangent, viewNormal );

			float occlusion = 0.0;

			for ( int i = 0; i < KERNEL_SIZE; i ++ ) {

				vec3 sampleVector = kernelMatrix * kernel[ i ];
				vec3 samplePoint = viewPosition + ( sampleVector * kernelRadius );

				vec4 samplePointNDC = cameraProjectionMatrix * vec4( samplePoint, 1.0 );
				samplePointNDC /= samplePointNDC.w;

				vec2 samplePointUv = samplePointNDC.xy * 0.5 + 0.5;

				float realDepth = getLinearDepth( samplePointUv );
				float sampleDepth = viewZToOrthographicDepth( samplePoint.z, cameraNear, cameraFar );
				float delta = sampleDepth - realDepth;

				if ( delta > minDistance && delta < maxDistance ) {

					occlusion += 1.0;

				}

			}

			occlusion = clamp( occlusion / float( KERNEL_SIZE ), 0.0, 1.0 );

			gl_FragColor = vec4( vec3( 1.0 - occlusion ), 1.0 );

		}`
	};
	const SSAODepthShader = {
		defines: {
			'PERSPECTIVE_CAMERA': 1
		},
		uniforms: {
			'tDepth': {
				value: null
			},
			'cameraNear': {
				value: null
			},
			'cameraFar': {
				value: null
			}
		},
		vertexShader: `varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader: `uniform sampler2D tDepth;

		uniform float cameraNear;
		uniform float cameraFar;

		varying vec2 vUv;

		#include <packing>

		float getLinearDepth( const in vec2 screenPosition ) {

			#if PERSPECTIVE_CAMERA == 1

				float fragCoordZ = texture2D( tDepth, screenPosition ).x;
				float viewZ = perspectiveDepthToViewZ( fragCoordZ, cameraNear, cameraFar );
				return viewZToOrthographicDepth( viewZ, cameraNear, cameraFar );

			#else

				return texture2D( tDepth, screenPosition ).x;

			#endif

		}

		void main() {

			float depth = getLinearDepth( vUv );
			gl_FragColor = vec4( vec3( 1.0 - depth ), 1.0 );

		}`
	};
	const SSAOBlurShader = {
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'resolution': {
				value: new THREE.Vector2()
			}
		},
		vertexShader: `varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader: `uniform sampler2D tDiffuse;

		uniform vec2 resolution;

		varying vec2 vUv;

		void main() {

			vec2 texelSize = ( 1.0 / resolution );
			float result = 0.0;

			for ( int i = - 2; i <= 2; i ++ ) {

				for ( int j = - 2; j <= 2; j ++ ) {

					vec2 offset = ( vec2( float( i ), float( j ) ) ) * texelSize;
					result += texture2D( tDiffuse, vUv + offset ).r;

				}

			}

			gl_FragColor = vec4( vec3( result / ( 5.0 * 5.0 ) ), 1.0 );

		}`
	};

	THREE.SSAOBlurShader = SSAOBlurShader;
	THREE.SSAODepthShader = SSAODepthShader;
	THREE.SSAOShader = SSAOShader;

} )();
		varying vec2 vUv;

		#include <packing>

		float getLinearDepth( const in vec2 screenPosition ) {

			#if PERSPECTIVE_CAMERA == 1

				float fragCoordZ = texture2D( tDepth, screenPosition ).x;
				float viewZ = perspectiveDepthToViewZ( fragCoordZ, cameraNear, cameraFar );
				return viewZToOrthographicDepth( viewZ, cameraNear, cameraFar );

			#else

				return texture2D( tDepth, screenPosition ).x;

			#endif

		}

		void main() {

			float depth = getLinearDepth( vUv );
			gl_FragColor = vec4( vec3( 1.0 - depth ), 1.0 );

		}`
	};
	const SSAOBlurShader = {
		uniforms: {
			'tDiffuse': {
				value: null
			},
			'resolution': {
				value: new THREE.Vector2()
			}
		},
		vertexShader: `varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,
		fragmentShader: `uniform sampler2D tDiffuse;

		uniform vec2 resolution;

		varying vec2 vUv;

		void main() {

			vec2 texelSize = ( 1.0 / resolution );
			float result = 0.0;

			for ( int i = - 2; i <= 2; i ++ ) {

				for ( int j = - 2; j <= 2; j ++ ) {

					vec2 offset = ( vec2( float( i ), float( j ) ) ) * texelSize;
					result += texture2D( tDiffuse, vUv + offset ).r;

				}

			}

			gl_FragColor = vec4( vec3( result / ( 5.0 * 5.0 ) ), 1.0 );

		}`
	};

	THREE.SSAOBlurShader = SSAOBlurShader;
	THREE.SSAODepthShader = SSAODepthShader;
	THREE.SSAOShader = SSAOShader;

} )();
