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

import { Payload, Send, WebSocket } from "@spacebar/gateway";
import { validateSchema, VoiceVideoSchema } from "@spacebar/util";
import { getClients, getRouter, VoiceOPCodes } from "../util";

// request:
// {
// 	"audio_ssrc": 0,
// 	"rtx_ssrc": 197,
// 	"streams": [
// 		{
// 			"active": false,
// 			"max_bitrate": 2500000,
// 			"max_framerate": 30,
// 			"max_resolution": {
// 				"height": 720,
// 				"type": "fixed",
// 				"width": 1280
// 			},
// 			"quality": 100,
// 			"rid": "100",
// 			"rtx_ssrc": 197,
// 			"ssrc": 196,
// 			"type": "video"
// 		}
// 	],
// 	"video_ssrc": 196
// }

export async function onVideo(this: WebSocket, payload: Payload) {
	if (!this.client) return;
	const { channel_id } = this.client;
	const d = validateSchema("VoiceVideoSchema", payload.d) as VoiceVideoSchema;
	console.log(d);

	await Send(this, { op: VoiceOPCodes.MEDIA_SINK_WANTS, d: { any: 100 } });

	if (d.audio_ssrc === 0) return;

	const router = getRouter(channel_id);
	if (!router) {
		console.error(`router not found`);
		return;
	}

	const transport = this.client.transport!;

	const producer = await transport.produce({
		kind: "audio",
		rtpParameters: {
			codecs: [
				{
					payloadType: 109,
					mimeType: "audio/opus",
					clockRate: 48000,
					channels: 2,
					rtcpFeedback: [{ type: "nack" }, { type: "transport-cc" }],
				},
			],
			encodings: [
				{
					ssrc: d.audio_ssrc,
				},
			],
			// headerExtensions: this.client
			// 	.sdpOffer2!.media[0].ext?.filter((x) =>
			// 		SUPPORTED_EXTENTIONS.includes(x.uri),
			// 	)
			// 	.map((x) => ({
			// 		uri: x.uri as NMediaSoupTypes.RtpHeaderExtensionUri,
			// 		id: x.value,
			// 		encrypt: false,
			// 	})),
		},
	});

	await producer.enableTraceEvent(["rtp"]);

	// producer.on("score", (score) => {
	// 	console.debug(`audio producer score:`, score);
	// });

	// producer.on("trace", (trace) => {
	// 	console.debug(`audio producer trace:`, trace);
	// });

	// this.client.producers.push(producer);
	this.client.producers.audio = producer;

	// loop the clients and add a consumer for each one
	const clients = getClients(channel_id);
	for (const client of clients) {
		if (client.websocket.user_id === this.user_id) continue;
		if (!client.transport) continue;

		const consumer = await client.transport.consume({
			producerId: producer.id,
			rtpCapabilities: router.router.rtpCapabilities,
			paused: false,
		});

		// listen to any events
		for (const event of consumer.eventNames()) {
			if (typeof event !== "string") continue;
			consumer.on(event as any, (...args) => {
				console.debug(
					`consumer(producer of ${this.user_id}; ${event}):`,
					args,
				);
			});
		}
		// listen to any events
		for (const event of consumer.observer.eventNames()) {
			if (typeof event !== "string") continue;
			consumer.observer.on(event as any, (...args) => {
				console.debug(
					`consumer observer(producer of ${this.user_id}; ${event}):`,
					args,
				);
			});
		}

		client.consumers.audio = consumer;
	}
}
