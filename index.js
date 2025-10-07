// marshall-ipcamera

const { InstanceBase, Regex, runEntrypoint } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const getActions = require('./actions')
const getFeedbacks = require('./feedbacks')
const { getVariables, defaultVariables } = require('./variables')
const getPresets = require('./presets')
const crypto = require('crypto')
const http = require('http')
const net = require('net')



class mCamInstance extends InstanceBase {
	constructor(internal) {
		super(internal)

		this.pollTimer = undefined
		this.pollCommands = [
			'camera',
			// 'freedconfig',
			'imaging',
			'mped2ts',
			'network',
			'ndi',
			'presetposition',
			'ptzf',
			'rtmp',
			'srt',
			'system',
			'tally',
			// 'user'
		]

		this.connTimer = undefined
		this.error = false
		this.requestTimeout = 1000
		
		// TCP/VISCA support for CV605
		this.tcpSocket = null
		this.tcpConnected = false
		this.viscaCommandQueue = []
		this.viscaResponseTimeout = 5000

		this.iFrameMapping = {
			stream1: {
				'59.94': {1: 60, 0.5: 30, 0.25: 15, 0.16: 10},
				'50': {1: 50, 0.5: 25},
				'29.97': {1: 30, 0.5: 15, 0.33: 10},
				'25': {1: 25}
			},
			stream2: {
				'59.94': {1: 60, 0.5: 30, 0.25: 15, 0.16: 10},
				'50': {1: 50, 0.5: 25},
				'29.97': {1: 30, 0.5: 15, 0.33: 10},
				'25': {1: 25, 0.5: 13, 0.33: 12},
				'1080i_59.94': {0.25: 15},
				'1080i_50': {0.5: 15}
			},
			stream3: {
				'29.97': {1: 30, 0.5: 15, 0.33: 10},
				'25': {1: 25, 0.5: 13, 0.33: 12}
			},
		}

		this.presetSpeed = {
			'0': '5 deg/sec',
			'1': '25 deg/sec',
			'2': '50 deg/sec',
			'3': '80 deg/sec',
			'4': '120 deg/sec',
			'5': '160 deg/sec',
			'6': '200 deg/sec',
			'7': '300 deg/sec'
		}

		this.data = {
			// audio
			AudioDelay: '',
			AudioDelayTime: '',
			AudioIn: '',
			AudioInVolume: '',
			MicLineSelect: '',

			// camera
			HdmiColor: '',
			Mirror: '',
			ModelName: '',
			OutputSource: '',
			OverlayTopLeftMode: '',
			OverlayTopRightMode: '',
			Resolution: '',
			Uptime: '',

			// exposure
			ExposureCompensation: '',
			ExposureExposureTime: '',
			ExposureExposureTimePri: '',
			ExposureGain: '',
			ExposureIris: '',
			ExposureIrisPri: '',
			ExposureMode: '',

			// focus
			FocusMode: '',
			PTZAssist: '',
			SmartAF: '',

			// image
			ColorHue: '',
			ColorSaturation: '',
			DigitalBrightLevel: '',
			DetailLevel: '',
			GammaLevel: '',
			ImageMode: '',
			NoiseReduction2DLevel: '',
			NoiseReduction3DLevel: '',
			PictureEffect: '',
			VisibilityEnhancerLevel: '',

			// ndi
			NdiEnable: '',

			// pan/tilt
			AbsolutePTZF: '',
			MotionSpeed: 1,
			PanLeftLimit: '',
			PanRightLimit: '',
			PanTiltLimit: '',
			PTZSpeedComp: '',
			TiltDownLimit: '',
			TiltUpLimit: '',

			// presets
			CallMode: '',
			PresetAF: '',
			PresetSpeed: '',
			PTZMotionSync: '',
			selectedPresetAction: 'PresetCall',

			// restarts
			restartEvents: {
				camera: false,
				stream: false
			},

			// streams
			BitRate1: 0,
			BitRate2: 0,
			BitRate3: 0,
			CBR1: '',
			CBR2: '',
			CBR3: '',
			FrameRate1: '',
			FrameRate2: '',
			FrameRate3: '',
			IFrameRatio1: '',
			IFrameRatio2: '',
			IFrameRatio3: '',
			ImageCodec1: '',
			ImageCodec2: '',
			ImageCodec3: '',
			ImageSize1: '',
			ImageSize2: '',
			ImageSize3: '',
			MPEG2TSEnable: '',
			RtmpEnable: '',
			SRTEnable: '',

			// tally
			TallyCMMDMode: '',
			TallyControl: '',
			TallyLevel: '',

			// white balance
			WhiteBalanceCrGain: '',
			WhiteBalanceCbGain: '',
			WhiteBalanceMode: '',

			// zoom
			CurrentZoomPos: 0,
			DZoomLimit: '',
			LastZoomPos: '',
			TempZoomPos: 0,
			ZoomSpeed: 1,
			ZoomTracking: 0,
		}

		this.restarts = {
			AudioIn: 'camera',
			BitRate1: 'stream',
			BitRate2: 'stream',
			BitRate3: 'stream',
			CBR1: 'stream',
			CBR2: 'stream',
			CBR3: 'stream',
			ImageSize2: 'stream',
			FrameRate2: 'stream',
			HdmiColor: 'camera',
			IFrameRatio1: 'stream',
			IFrameRatio2: 'stream',
			IFrameRatio3: 'stream',
			ImageCodec1: 'stream',
			ImageCodec2: 'stream',
			ImageCodec3: 'stream',
			OutputSource: 'camera',
			Resolution: 'camera',
			SmartAF: 'camera',
			NdiEnable: 'camera',
		}
	}

	async destroy() {
		if (this.pollTimer !== undefined) {
			clearInterval(this.pollTimer)
			delete this.pollTimer
		}
		
		// Close TCP connection for CV605
		if (this.tcpSocket) {
			this.tcpSocket.destroy()
			this.tcpSocket = null
			this.tcpConnected = false
		}
	}

	async init(config) {
		this.updateStatus('connecting')
		this.configUpdated(config)
	}

	async configUpdated(config) {
		// polling is running and polling has been de-selected by config change
		if (this.pollTimer !== undefined) {
			clearInterval(this.pollTimer)
			delete this.pollTimer
		}
		this.config = config
		
		console.log('debug', 'Config updated:', {
			host: this.config.host,
			username: this.config.username
		})
		
		this.initActions()
		this.initFeedbacks()
		this.initVariables()
		this.initPresets()

		console.log('debug', 'Try to connect...')
		
		// Try TCP connection first (for CV605), then fall back to HTTP
		this.connTimer = setInterval(() => {
			this.init_tcp_connection()
		}, 1000)
	}

	async init_api() {

		let parameters = []
		this.pollCommands.forEach((command) => {
			parameters.push(['inqjs', command])
		})

		const system = await this.makeRequest('inquiry', parameters)

		if (system.status == 200) {
			console.log('debug', 'Connection succeeded!')
			if (this.connTimer !== undefined) {
				clearInterval(this.connTimer)
				delete this.connTimer
			}
			this.initCommunication()
		}
	}

	async init_tcp_connection() {
		if (this.tcpConnected) {
			return
		}

		// If we've already tried TCP and failed, try HTTP instead
		if (this.tcpConnectionAttempted) {
			console.log('debug', 'TCP failed, trying HTTP connection')
			this.connTimer = setInterval(() => {
				this.init_api()
			}, 1000)
			return
		}

		this.tcpConnectionAttempted = true
		console.log('debug', `Attempting TCP connection to ${this.config.host}:1259`)

		try {
			this.tcpSocket = new net.Socket()
			
			this.tcpSocket.on('connect', () => {
				console.log('debug', 'TCP connection to CV605 established')
				this.tcpConnected = true
				this.isCV605 = true
				if (this.connTimer !== undefined) {
					clearInterval(this.connTimer)
					delete this.connTimer
				}
				this.updateStatus('ok')
				this.initCommunication()
			})

			this.tcpSocket.on('data', (data) => {
				this.handleViscaResponse(data)
			})

			this.tcpSocket.on('error', (err) => {
				console.log('debug', 'TCP connection failed, will try HTTP:', err.message)
				this.tcpConnected = false
				this.tcpConnectionAttempted = true
				// Don't update status here, let it try HTTP
			})

			this.tcpSocket.on('close', () => {
				console.log('debug', 'TCP connection closed')
				this.tcpConnected = false
				this.updateStatus('disconnected')
			})

			// Connect to CV605 on port 1259
			this.tcpSocket.connect(1259, this.config.host)
			
		} catch (err) {
			console.log('debug', 'Failed to create TCP connection, will try HTTP:', err.message)
			this.tcpConnectionAttempted = true
		}
	}

	initCommunication() {
		if (this.communicationInitiated !== true) {
			if (this.isCV605) {
				// For CV605, we don't need polling as VISCA is command-based
				this.updateStatus('ok')
			} else {
				this.initPolling()
				this.updateStatus('ok')
			}

			this.communicationInitiated = true

			console.log('debug', 'Instance ready to use!')
		}		
	}

	async errorCommunication(err) {
		if (!this.error) {
			console.log('error', err)
			this.error = true
			this.updateStatus(err.data.code)
			this.communicationInitiated = false
			if (this.pollTimer !== undefined) {
				clearInterval(this.pollTimer)
				delete this.pollTimer
			}
			console.log('debug', 'Try to connect...')
			this.connTimer = setInterval(() => {
				this.init_api()
			}, 1000)
		}
	}

	initPolling() {
		if (this.pollTimer === undefined && this.config.pollInterval > 0) {
			let parameters = []
			this.pollCommands.forEach((command) => {
				parameters.push(['inqjs', command])
			})
			this.pollTimer = setInterval(() => {
				this.sendPollCommands(parameters)
			}, this.config.pollInterval)
		}
	}

	sendPollCommands(parameters) {
		this.makeRequest('inquiry', parameters) // request device info
		.then((res) => {
			if (res.status == 200) {
				if (this.error) {
					this.error = false
				}
				this.updateData(res.data.inquiry, this.data, [ // update from response
					// audio
					'AudioDelay',
					'AudioDelayTime',
					'AudioIn',
					'AudioInVolume',
					'MicLineSelect',

					// camera
					'HdmiColor',
					'Mirror',
					'ModelName',
					'OutputSource',
					'OverlayTopLeftMode',
					'OverlayTopRightMode',
					'Resolution',
					'Uptime',

					// exposure
					'ExposureCompensation',
					'ExposureExposureTime',
					'ExposureExposureTimePri',
					'ExposureGain',
					'ExposureIris',
					'ExposureIrisPri',
					'ExposureMode',

					// focus
					'FocusMode',
					'PTZAssist',
					'SmartAF',

					// image
					'ColorHue',
					'ColorSaturation',
					'DigitalBrightLevel',
					'DetailLevel',
					'GammaLevel',
					'ImageMode',
					'NoiseReduction2DLevel',
					'NoiseReduction3DLevel',
					'PictureEffect',
					'VisibilityEnhancerLevel',

					// ndi
					'NdiEnable',

					// pan/tilt
					'AbsolutePTZF',
					'PanLeftLimit',
					'PanRightLimit',
					'PanTiltLimit',
					'PTZMotionSync',
					'PTZSpeedComp',
					'TiltDownLimit',
					'TiltUpLimit',

					// presets
					'CallMode',
					'PresetAF',
					'PresetSpeed',

					// streams
					'BitRate1',
					'BitRate2',
					'BitRate3',
					'CBR1',
					'CBR2',
					'CBR3',
					'FrameRate1',
					'FrameRate2',
					'FrameRate3',
					'IFrameRatio1',
					'IFrameRatio2',
					'IFrameRatio3',
					'ImageCodec1',
					'ImageCodec2',
					'ImageCodec3',
					'ImageSize1',
					'ImageSize2',
					'ImageSize3',
					'MPEG2TSEnable',
					'RtmpEnable',
					'SRTEnable',

					// tally
					'TallyCMMDMode',
					'TallyControl',
					'TallyLevel',

					// white balance
					'WhiteBalanceCrGain',
					'WhiteBalanceCbGain',
					'WhiteBalanceMode',

					// zoom
					'DZoomLimit',
					'ZoomTracking',
				])
			}
			else if (!res.response) {
				this.errorCommunication(res)
			}
		})
	}

	parseFocusMode(mode, smart) {
		if (mode == 'auto' && smart == 'on') {
			return 'Auto-Face'
		}
		return (mode == 'auto') ? 'Auto' : 'Manual'
	}

	parseNorm(resolution) {
		if (resolution[resolution.length-3] !== '_') {
			return resolution.slice(0, -2).replace('_', '/') + '.' + resolution.slice(-2)
		}
		return resolution.replace('_', '/')
	}

	parseNR(value) {
		return {
			'0': 'Off',
			'1': 'Low',
			'2': 'Mid',
			'3': 'High'
		}[value]
	}

	parseComp(value) {
		return {
			'0': ['-5.0 dB', '-8.0 dB'],
			'1': ['-4.0 dB', '-6.4 dB'],
			'2': ['-3.0 dB', '-4.8 dB'],
			'3': ['-2.0 dB', '-3.2 dB'],
			'4': ['-1.0 dB', '-1.6 dB'],
			'5': ['0.0 dB', '0.0 dB'],
			'6': ['+1.0 dB', '+1.6 dB'],
			'7': ['+2.0 dB', '+3.2 dB'],
			'8': ['+3.0 dB', '+4.8 dB'],
			'9': ['+4.0 dB', '+6.4 dB'],
			'10': ['+5.0 dB', '+8.0 dB']
		}[value]
	}

	parseShut() {
		let value = (this.data.ExposureMode == 'shutter') ? this.data.ExposureExposureTimePri : this.data.ExposureExposureTime
		return {
            '21': ['1/1', '1/1'],
            '20': ['1/2', '1/2'],
            '19': ['1/4', '1/4'],
            '18': ['1/8', '1/8'],
            '17': ['1/15', '1/12'],
            '16': ['1/30', '1/25'],
            '15': ['1/60', '1/50'],
            '14': ['1/90', '1/75'],
            '13': ['1/100', '1/100'],
            '12': ['1/120', '1/120'],
            '11': ['1/180', '1/150'],
            '10': ['1/250', '1/215'],
            '9': ['1/350', '1/300'],
            '8': ['1/500', '1/425'],
            '7': ['1/725', '1/600'],
            '6': ['1/1000', '1/1000'],
            '5': ['1/1500', '1/1250'],
            '4': ['1/2000', '1/1750'],
            '3': ['1/2500', '1/2500'],
            '2': ['1/3000', '1/3000'],
            '1': ['1/5000', '1/5000'],
            '0': ['1/10000', '1/10000']
		}[value]
	}

	parseIris() {
		let value = (this.data.ExposureMode == 'iris') ? this.data.ExposureIrisPri : this.data.ExposureIris
		return {
            '15': 'Closed',
			'14': 'F1.6',
            '13': 'F2.0',
            '12': 'F2.2',
            '11': 'F2.7',
            '10': 'F3.2',
            '9': 'F3.8',
            '8': 'F4.5',
            '7': 'F5.4',
            '6': 'F6.3',
            '5': 'F7.8',
            '4': 'F9.0',
            '3': 'F11',
            '2': 'F13',
            '1': 'F16',
            '0': 'F18'
		}[value]
	}

	parseExp(value) {
		return {
			'auto': 'Full Auto',
			'shutter': 'Shutter-Prio',
			'iris': 'Iris-Prio',
			'manual': 'Manual'
		}[value]
	}

	parseWdr(value) {
		return {
			'0': 'Off',
			'1': 'Low',
			'2': 'Mid',
			'3': 'High'
		}[value]
	}

	parsePositions([x, y, z, f]) {
		this.data.LastZoomPos = this.data.TempZoomPos
		this.data.TempZoomPos = this.data.CurrentZoomPos
		this.data.CurrentZoomPos = parseInt(z, 16)
	}

	updateData(source, target, variables) {
		variables.forEach((variable) => { // update internal data object
			target[variable] = source[variable]
		})

		this.parsePositions(target.AbsolutePTZF.split(','))

		this.setVariableValues({ // update variables
			// audio
			audio_delay_time: target.AudioDelayTime,
			audio_level: target.MicLineSelect,
			audio_volume: target.AudioInVolume,

			// camera
			camera_image_orientation: target.Mirror.replace('off', 'normal'),
			camera_model: target.ModelName,
			camera_uptime: target.Uptime,
			camera_video_norm: this.parseNorm(target.Resolution),

			// exposure
			exposure_compensation: this.parseComp(target.ExposureCompensation,)[(['CV420e', 'CV730', 'CV730-NDI', 'CV730-HN'].includes(target.ModelName)) ? 1 : 0],
			exposure_gain: `+${(parseInt(target.ExposureGain)-1)*3} dB`,
			exposure_iris: this.parseIris(),
			exposure_mode: this.parseExp(target.ExposureMode),
			exposure_shutter_speed: this.parseShut()[(['25', '50'].includes(target.Resolution.slice(-2))) ? 1 : 0],

			// focus
			focus_mode: this.parseFocusMode(target.FocusMode, target.SmartAF),

			// image
			image_2d_noise_reduction: this.parseNR(target.NoiseReduction2DLevel),
			image_3d_noise_reduction: this.parseNR(target.NoiseReduction3DLevel),
			image_brightness: target.DigitalBrightLevel,
			image_gamma: target.GammaLevel,
			image_hue: target.ColorHue,
			image_saturation: target.ColorSaturation,
			image_sharpness: target.DetailLevel,
			image_wdr: this.parseWdr(target.VisibilityEnhancerLevel),

			// pan/tilt
			pt_motion_speed: target.MotionSpeed,
			pt_pan_left_limit: target.PanLeftLimit,
			pt_pan_right_limit: target.PanRightLimit,
			pt_tilt_down_limit: target.TiltDownLimit,
			pt_tilt_up_limit: target.TiltUpLimit,

			// presets
			preset_call_mode: target.CallMode,
			preset_execution_speed: this.presetSpeed[target.PresetSpeed],

			// streams
			stream1_bitrate: target.BitRate1,
			stream1_frame_rate: target.FrameRate1,
			// stream1_keyframe_interval: target.IFrameRatio1,
			stream1_mode: (target.CBR1 == 'on') ? 'CBR' : 'VBR',
			stream1_resolution: target.ImageSize1.replace(',', 'x'),
			stream2_bitrate: target.BitRate2,
			stream2_frame_rate: target.FrameRate2,
			// stream2_keyframe_interval: target.IFrameRatio2,
			stream2_mode: (target.CBR2 == 'on') ? 'CBR' : 'VBR',
			stream2_resolution: target.ImageSize2.replace(',', 'x'),
			stream3_bitrate: target.BitRate3,
			stream3_mode: (target.CBR3 == 'on') ? 'CBR' : 'VBR',
			// stream3_frame_rate: target.FrameRate3,
			stream3_keyframe_interval: target.IFrameRatio3,
			stream3_resolution: target.ImageSize3.replace(',', 'x'),

			// white balance
			wb_gain_blue: target.WhiteBalanceCbGain,
			wb_gain_red: target.WhiteBalanceCrGain,
			wb_mode: target.WhiteBalanceMode,

			// zoom
			zoom_digital_zoom_limit: (target.DZoomLimit == 'x1') ? 'OFF' : target.DZoomLimit,
			zoom_speed: target.ZoomSpeed,
		})

		this.checkFeedbacks() // update feedbacks
	}

	getAuth(auth_str) { // parse auth-header for nonce an other info
		let auth = {request_method: 'GET'}
		Object.assign(auth, {auth_method: auth_str.slice(0, auth_str.indexOf(' '))})
		auth_str.replace(`${auth.auth_method} `, '').split(', ').forEach((parameter) => {
			let [key, value] = parameter.split('=')
			Object.assign(auth, {[key]: value.replaceAll('"', '')})
		})
		return auth
	}

	parseInqjs(data) { // parse response data
		let output = {}
		data.split('\r\n').slice(0,-1).forEach((item) => {
			item = item.slice(4)
			let name = item.slice(0,item.indexOf('='))
			let value = item.slice(item.indexOf('=')+1)
			if (value[0] == '"') {
				value = value.slice(1)
			}
			if (value.slice(-1) == '"') {
				value = value.slice(0,-1)
			}
			Object.assign(output, {[name]: value.trim()})
		})
		return output
	}

	async requestData(url, auth='', getData=false, wait=true) {

		return new Promise ((resolve) => {
			const req = http.get(url, {headers: {Connection: 'keep-alive', Authorization: auth}}) // new request

			if (wait) {
				req.on('socket', (socket) => { // wait for connection
					socket.setTimeout(this.requestTimeout, () => { // set request timeout
						req.destroy({
							status: 0,
							headers: {},
							data: {
								error: {
									type: 'request timeout',
									url: url
								}
							}
						})
					})
				})
			}

			req.on('error', (err) => { // process request errors
				resolve(err)
			})

			req.on('response', (res) => { // receiving response
				if (res.statusCode != 200 && !getData) {
					res.destroy({
						status: res.statusCode,
						headers: res.headers,
						data: {}
					})
				}
				else if (res.statusCode != 200) {
					res.destroy({
						status: res.statusCode,
						headers: {},
						data: {
							error: {
								type: 'authorization required',
								url: url
							}
						}
					})
				}
				else if (res.statusCode == 200 && getData) {
					let data = ''
					res.on('data', chunk => { // 
						data += chunk
					})

					res.on('end', () => {
						resolve({status: res.statusCode, data: {'inquiry': this.parseInqjs(data)}})
					})
				}
				else {
					res.destroy({
						status: res.statusCode,
						headers: {},
						data: {}
					})
				}

				// res.setTimeout(this.requestTimeout, () => { // set response timeout
				// 	res.destroy({
				// 		status: 0,
				// 		headers: {},
				// 		data: {
				// 			error: {
				// 				type: 'response timeout',
				// 				url: url
				// 			}
				// 		}
				// 	})
				// })

				res.on('error', (err) => { // process request errors
					resolve(err)
				})
			})
		})
	}

	createAuth(auth, uri) {
		const HA1 = crypto.createHash('md5').update(`${this.config.username}:${auth.realm}:${this.config.password}`).digest('hex') // create HA1 from 'user:realm:pass'
		const HA2 = crypto.createHash('md5').update(`${auth.request_method}:${uri}`).digest('hex') // create HA2 from 'request_method:uri'
		const cnonce = crypto.createHash('sha1').update(1 + auth.nonce + Date.now()).digest('hex').slice(-16) // create random and unique clinet-nonce
		const RESP = crypto.createHash('md5').update(`${HA1}:${auth.nonce}:00000001:${cnonce}:${auth.qop}:${HA2}`).digest('hex') // create response from 'HA1:nonce_count:cnonce:qop:HA2'
			
		return `${auth.auth_method} username="${this.config.username}", realm="${auth.realm}", nonce="${auth.nonce}", uri="${uri}", algorithm=${auth.algorithm}, response="${RESP}", qop=${auth.qop}, nc=00000001, cnonce="${cnonce}"`
	}

	async makeRequest(endpoint, parameters=[]) { // make a request and handle authentication

		let uri = `/command/${endpoint}.cgi?`

		let restarts = []
		parameters.forEach(([key, value]) => { // adding parameters to uri
			if (Object.keys(this.restarts).includes(key)) { // checking for restart events
				restarts.push(this.restarts[key])
			}
			uri += `${key}=${value}&`
		})
		uri = uri.slice(0,-1) // finalize uri

		if (restarts.length > 0) { // set start of restart event feedback
			for (let event of restarts) {
				if (this.data.restartEvents[event]) { // block actions if internal restarts happen
					return this.returRequest({
						status: 0,
						headers: {},
						data: {
							error: {
								type: `blocked by event "${event}"`,
								url: 'http://' + this.config.host + uri
							}
						}
					}, restarts)
				}
			}
			restarts.forEach((event) => {
				if (!this.data.restartEvents[event]) {
					this.data.restartEvents[event] = true
				}
			})
		}
		if (this.data.restartEvents.camera) { // change instance status when whole device is restarting
			this.updateStatus('camera restarting...')
		}

		const auth_req = await this.requestData('http://' + this.config.host + '/command/user.cgi') // request authentication data
		
		if (!auth_req.headers['www-authenticate']) { // return auth request if not successful
			return this.returRequest(auth_req, restarts)
		}

		const auth_data = this.createAuth(this.getAuth(auth_req.headers['www-authenticate']), uri) // create authentication string
		const data_req = await this.requestData('http://' + this.config.host + uri, auth_data, (endpoint == 'inquiry') ? true : false, (restarts.length == 0) ? true : false) // request data

		return this.returRequest(data_req, restarts)
	}

	returRequest(data, restarts) {
		if (restarts.length > 0) { // set end of restart event feedback
			restarts.forEach((event) => {
				this.data.restartEvents[event] = false
			})
		}
		if (this.data.restartEvents.camera == false && restarts.includes('camera')) { // change instance status when whole device has restarted
			this.updateStatus('ok')
		}
		return data
	}

	// VISCA Protocol Methods for CV605
	sendViscaCommand(command) {
		if (!this.tcpConnected || !this.tcpSocket) {
			console.log('error', 'TCP not connected, cannot send VISCA command')
			return Promise.reject(new Error('TCP not connected'))
		}

		return new Promise((resolve, reject) => {
			const commandBuffer = Buffer.from(command)
			this.tcpSocket.write(commandBuffer, (err) => {
				if (err) {
					reject(err)
				} else {
					// Set up response timeout
					const timeout = setTimeout(() => {
						reject(new Error('VISCA command timeout'))
					}, this.viscaResponseTimeout)
					
					// Store the promise resolve/reject for when we get a response
					this.viscaCommandQueue.push({ resolve, reject, timeout })
				}
			})
		})
	}

	handleViscaResponse(data) {
		const response = Array.from(data).map(byte => byte.toString(16).padStart(2, '0')).join(' ')
		console.log('debug', 'VISCA Response:', response)
		
		// Check for ACK (90 4y FF) or Completion (90 5y FF)
		if (data.length >= 3 && data[0] === 0x90) {
			if (data[2] === 0xFF) {
				const command = this.viscaCommandQueue.shift()
				if (command) {
					clearTimeout(command.timeout)
					if (data[1] === 0x50) { // Completion
						command.resolve({ status: 'completed', response: response })
					} else if (data[1] === 0x40) { // ACK
						command.resolve({ status: 'ack', response: response })
					} else {
						command.resolve({ status: 'response', response: response })
					}
				}
			}
		}
	}

	// VISCA Command Builders
	buildViscaCommand(command, params = []) {
		// VISCA commands start with 81 (camera address 1)
		let cmd = [0x81]
		cmd = cmd.concat(command)
		cmd = cmd.concat(params)
		cmd.push(0xFF) // End of command
		return cmd
	}

	// Camera Control Commands
	async viscaPanTiltUp(speed = 0x18) {
		return this.sendViscaCommand(this.buildViscaCommand([0x01, 0x06, 0x01], [speed, speed, 0x03, 0x01]))
	}

	async viscaPanTiltDown(speed = 0x18) {
		return this.sendViscaCommand(this.buildViscaCommand([0x01, 0x06, 0x01], [speed, speed, 0x03, 0x02]))
	}

	async viscaPanTiltLeft(speed = 0x18) {
		return this.sendViscaCommand(this.buildViscaCommand([0x01, 0x06, 0x01], [speed, speed, 0x01, 0x03]))
	}

	async viscaPanTiltRight(speed = 0x18) {
		return this.sendViscaCommand(this.buildViscaCommand([0x01, 0x06, 0x01], [speed, speed, 0x02, 0x03]))
	}

	async viscaPanTiltStop() {
		return this.sendViscaCommand(this.buildViscaCommand([0x01, 0x06, 0x01], [0x00, 0x00, 0x03, 0x03]))
	}

	async viscaZoomIn(speed = 0x07) {
		return this.sendViscaCommand(this.buildViscaCommand([0x01, 0x04, 0x07], [0x20 + speed]))
	}

	async viscaZoomOut(speed = 0x07) {
		return this.sendViscaCommand(this.buildViscaCommand([0x01, 0x04, 0x07], [0x30 + speed]))
	}

	async viscaZoomStop() {
		return this.sendViscaCommand(this.buildViscaCommand([0x01, 0x04, 0x07], [0x00]))
	}

	async viscaFocusFar(speed = 0x07) {
		return this.sendViscaCommand(this.buildViscaCommand([0x01, 0x04, 0x08], [0x20 + speed]))
	}

	async viscaFocusNear(speed = 0x07) {
		return this.sendViscaCommand(this.buildViscaCommand([0x01, 0x04, 0x08], [0x30 + speed]))
	}

	async viscaFocusStop() {
		return this.sendViscaCommand(this.buildViscaCommand([0x01, 0x04, 0x08], [0x00]))
	}

	async viscaPresetCall(preset) {
		return this.sendViscaCommand(this.buildViscaCommand([0x01, 0x04, 0x3F], [0x02, preset]))
	}

	async viscaPresetSet(preset) {
		return this.sendViscaCommand(this.buildViscaCommand([0x01, 0x04, 0x3F], [0x01, preset]))
	}

	// Modified makeRequest to handle both HTTP and VISCA
	async makeRequest(endpoint, parameters = []) {
		// If this is a CV605 camera, use VISCA commands
		if (this.isCV605) {
			return this.handleViscaRequest(endpoint, parameters)
		}
		
		// Otherwise use existing HTTP method
		return this.makeHttpRequest(endpoint, parameters)
	}

	async handleViscaRequest(endpoint, parameters) {
		// Map HTTP endpoints to VISCA commands
		const [command, value] = parameters[0] || []
		
		try {
			switch (command) {
				case 'PanTiltUp':
					return await this.viscaPanTiltUp()
				case 'PanTiltDown':
					return await this.viscaPanTiltDown()
				case 'PanTiltLeft':
					return await this.viscaPanTiltLeft()
				case 'PanTiltRight':
					return await this.viscaPanTiltRight()
				case 'PanTiltStop':
					return await this.viscaPanTiltStop()
				case 'ZoomIn':
					return await this.viscaZoomIn()
				case 'ZoomOut':
					return await this.viscaZoomOut()
				case 'ZoomStop':
					return await this.viscaZoomStop()
				case 'FocusFar':
					return await this.viscaFocusFar()
				case 'FocusNear':
					return await this.viscaFocusNear()
				case 'FocusStop':
					return await this.viscaFocusStop()
				case 'PresetCall':
					return await this.viscaPresetCall(value)
				case 'PresetSet':
					return await this.viscaPresetSet(value)
				default:
					console.log('debug', 'Unknown VISCA command:', command)
					return { status: 200, data: {} }
			}
		} catch (err) {
			console.log('error', 'VISCA command failed:', err.message)
			return { status: 500, data: { error: err.message } }
		}
	}

	// Rename the existing makeRequest to makeHttpRequest
	async makeHttpRequest(endpoint, parameters = []) {
		let uri = `/command/${endpoint}.cgi?`

		let restarts = []
		parameters.forEach(([key, value]) => { // adding parameters to uri
			if (Object.keys(this.restarts).includes(key)) { // checking for restart events
				restarts.push(this.restarts[key])
			}
			uri += `${key}=${value}&`
		})
		uri = uri.slice(0,-1) // finalize uri

		if (restarts.length > 0) { // set start of restart event feedback
			for (let event of restarts) {
				if (this.data.restartEvents[event]) { // block actions if internal restarts happen
					return this.returRequest({
						status: 0,
						headers: {},
						data: {
							error: {
								type: `blocked by event "${event}"`,
								url: 'http://' + this.config.host + uri
							}
						}
					}, restarts)
				}
			}
			restarts.forEach((event) => {
				if (!this.data.restartEvents[event]) {
					this.data.restartEvents[event] = true
				}
			})
		}
		if (this.data.restartEvents.camera) { // change instance status when whole device is restarting
			this.updateStatus('camera restarting...')
		}

		const auth_req = await this.requestData('http://' + this.config.host + '/command/user.cgi') // request authentication data
		
		if (!auth_req.headers['www-authenticate']) { // return auth request if not successful
			return this.returRequest(auth_req, restarts)
		}

		const auth_data = this.createAuth(this.getAuth(auth_req.headers['www-authenticate']), uri) // create authentication string
		const data_req = await this.requestData('http://' + this.config.host + uri, auth_data, (endpoint == 'inquiry') ? true : false, (restarts.length == 0) ? true : false) // request data

		return this.returRequest(data_req, restarts)
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Information',
				value: 'This module will connect to Marshall IP-Cameras',
			},
			{
				type: 'textinput',
				id: 'host',
				label: 'IP Address',
				width: 6,
				default: '',
				regex: Regex.IP,
			},
			{
				type: 'number',
				id: 'pollInterval',
				label: 'Polling Interval (ms), set to 0 to disable polling',
				min: 50,
				max: 1000,
				default: 200,
				width: 3,
			},
			{
				type: 'textinput',
				id: 'username',
				label: 'User Name',
				width: 6,
				default: 'admin',
			},
			{
				type: 'textinput',
				id: 'password',
				label: 'Password',
				width: 6,
				default: '9999',
			},
		]
	}

	initActions() {
		this.setActionDefinitions(getActions(this))
	}

	initFeedbacks() {
		this.setFeedbackDefinitions(getFeedbacks(this))
	}

	initVariables() {
		this.setVariableDefinitions(getVariables(this))
		this.setVariableValues(defaultVariables())
	}

	initPresets() {
		this.setPresetDefinitions(getPresets(this))
	}
}

runEntrypoint(mCamInstance, UpgradeScripts)