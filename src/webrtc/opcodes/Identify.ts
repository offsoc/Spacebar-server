/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Spacebar and Spacebar Contributors
	
	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.
	
	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { CLOSECODES, Payload, Send, WebSocket } from "@spacebar/gateway";
import {
	validateSchema,
	VoiceIdentifySchema,
	VoiceReadySchema,
	VoiceState,
} from "@spacebar/util";
import {
	getClients,
	getOrCreateRouter,
	getWorker,
	Stream,
	VoiceOPCodes,
} from "@spacebar/webrtc";

export interface IdentifyPayload extends Payload {
	d: {
		server_id: string; //guild id
		session_id: string; //gateway session
		streams: Stream[];
		token: string; //voice_states token
		user_id: string;
		video: boolean;
		max_dave_protocol_version?: number; // present in v8, not sure what version added it
	};
}

export async function onIdentify(this: WebSocket, data: IdentifyPayload) {
	clearTimeout(this.readyTimeout);
	const { server_id, user_id, session_id, token, streams, video } =
		validateSchema("VoiceIdentifySchema", data.d) as VoiceIdentifySchema;

	const voiceState = await VoiceState.findOne({
		where: { guild_id: server_id, user_id, token, session_id },
	});
	if (!voiceState) return this.close(CLOSECODES.Authentication_failed);

	this.user_id = user_id;
	this.session_id = session_id;

	const worker = getWorker();
	const router = await getOrCreateRouter(voiceState.channel_id);
	console.debug(`onIdentify(router)`, router.id);

	const producerTransport = await router.createWebRtcTransport({
		webRtcServer: worker.appData.webRtcServer!,
		enableUdp: true,
	} as any);

	// producerTransport.enableTraceEvent(["bwe", "probation"]);

	// listen to any events
	for (const event of producerTransport.eventNames()) {
		if (typeof event !== "string") continue;
		producerTransport.on(event as any, (...args) => {
			console.debug(`producerTransport event: ${event}`, args);
		});
	}
	// listen to any events
	for (const event of producerTransport.observer.eventNames()) {
		if (typeof event !== "string") continue;
		producerTransport.observer.on(event as any, (...args) => {
			console.debug(`producerTransport observer event: ${event}`, args);
		});
	}

	// const consumerTransport = await router.createWebRtcTransport({
	// 	webRtcServer: worker.appData.webRtcServer!,
	// 	enableUdp: true,
	// });
	// consumerTransport.enableTraceEvent(["bwe", "probation"]);

	// // listen to any events
	// for (const event of consumerTransport.eventNames()) {
	// 	if (typeof event !== "string") continue;
	// 	consumerTransport.on(event as any, (...args) => {
	// 		console.debug(`consumerTransport event: ${event}`, args);
	// 	});
	// }

	this.client = {
		websocket: this,
		ssrc: 1,
		channel_id: voiceState.channel_id,
		codecs: [],
		streams: streams!,
		headerExtensions: [],
		producers: new Map(),
		consumers: new Map(),
		transports: {
			producer: producerTransport,
		},
	};

	const clients = getClients(voiceState.channel_id)!;
	clients.add(this.client);

	this.on("close", () => {
		clients.delete(this.client!);
	});

	const d = {
		op: VoiceOPCodes.READY,
		d: {
			streams: streams?.map((x) => ({
				...x,
				ssrc: ++this.client!.ssrc, // first stream should be 2
				rtx_ssrc: ++this.client!.ssrc, // first stream should be 3
			})),
			ssrc: this.client.ssrc, // this is just a base, first stream ssrc will be +1 with rtx +2
			ip: "192.168.10.112",
			port: 20000,
			modes: [
				"aead_aes256_gcm_rtpsize",
				"aead_aes256_gcm",
				"aead_xchacha20_poly1305_rtpsize",
				"xsalsa20_poly1305_lite_rtpsize",
				"xsalsa20_poly1305_lite",
				"xsalsa20_poly1305_suffix",
				"xsalsa20_poly1305",
			],
			experiments: ["fixed_keyframe_interval"],
		} as VoiceReadySchema,
	};

	console.debug(`onIdentify(ready packet)`, d);
	await Send(this, d);
}
