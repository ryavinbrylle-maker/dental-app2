const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.env.PORT || process.argv[2] || 8080);
const webRoot = __dirname;
const appointments = [];
const validStatuses = ['Scheduled', 'Checked in', 'Completed'];
const validConsents = ['On file', 'Pending', 'Not required'];
const validSections = ['A', 'B', 'C'];
let nextId = 1;

function localDate(offsetDays = 0) {
	const date = new Date();
	date.setDate(date.getDate() + offsetDays);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function addSeed(student, grade, section, treatment, date, time, dentist, consent, status) {
	appointments.push({ id: nextId++, student, grade, section, treatment, date, time, dentist, consent, status });
}

addSeed('Ava Parker', 'Grade 2', 'A', 'Preventive screening', localDate(), '09:00', 'Dr. Maya Chen', 'On file', 'Scheduled');
addSeed('Jordan Lee', 'Grade 5', 'B', 'Toothache assessment', localDate(), '10:30', 'Dr. Oliver Patel', 'Pending', 'Checked in');
addSeed('Mia Carter', 'Kindergarten', 'A', 'Fluoride varnish', localDate(), '13:00', 'Dr. Maya Chen', 'On file', 'Scheduled');
addSeed('Noah Williams', 'Grade 3', 'C', 'Sealant review', localDate(1), '09:30', 'Dr. Sofia Reyes', 'On file', 'Scheduled');
addSeed('Sofia Martinez', 'Grade 1', 'B', 'Oral health check', localDate(1), '14:00', 'Dr. Oliver Patel', 'Pending', 'Scheduled');
addSeed('Leo Thompson', 'Grade 4', 'A', 'Follow-up visit', localDate(-1), '11:00', 'Dr. Maya Chen', 'On file', 'Completed');

function sendJson(response, status, value) {
	const body = JSON.stringify(value);
	response.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': Buffer.byteLength(body),
		'X-Content-Type-Options': 'nosniff'
	});
	response.end(body);
}

function readForm(request) {
	return new Promise((resolve, reject) => {
		let body = '';
		request.setEncoding('utf8');
		request.on('data', chunk => {
			body += chunk;
			if (body.length > 16384) {
				reject(new Error('Request body is too large.'));
				request.destroy();
			}
		});
		request.on('end', () => resolve(Object.fromEntries(new URLSearchParams(body))));
		request.on('error', reject);
	});
}

function isValidDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	return parsed.getUTCFullYear() === year
		&& parsed.getUTCMonth() === month - 1
		&& parsed.getUTCDate() === day;
}

function createAppointment(form) {
	const student = (form.student || '').trim();
	const grade = (form.grade || '').trim();
	const section = (form.section || '').trim();
	const treatment = (form.treatment || '').trim();
	const dentist = (form.dentist || '').trim();
	const consent = (form.consent || '').trim();
	const status = (form.status || 'Scheduled').trim();
	const date = (form.date || '').trim();
	const time = (form.time || '').trim();
	const today = localDate();
	if (student.length > 80 || (grade && !/^Kindergarten$|^Grade ([1-8])$/.test(grade))
			|| (section && !validSections.includes(section))
			|| treatment.length > 80 || dentist.length > 80
			|| (consent && !validConsents.includes(consent))
			|| (date && (!isValidDate(date) || date < today))
			|| (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
			|| !['Scheduled', 'Checked in'].includes(status)) {
		return null;
	}
	return {
		id: nextId++, student, grade, section, treatment, date,
		time, dentist, consent, status
	};
}

async function handleAppointments(request, response, pathname) {
	if (pathname === '/api/appointments' && request.method === 'GET') {
		const sorted = [...appointments].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
		sendJson(response, 200, sorted);
		return;
	}

	if (pathname === '/api/appointments' && request.method === 'POST') {
		try {
			const appointment = createAppointment(await readForm(request));
			if (!appointment) {
				sendJson(response, 400, { error: 'Check the values entered and try again.' });
				return;
			}
			appointments.push(appointment);
			sendJson(response, 201, appointment);
		} catch (error) {
			if (!response.destroyed) sendJson(response, 400, { error: error.message });
		}
		return;
	}

	const statusRoute = pathname.match(/^\/api\/appointments\/(\d+)\/status$/);
	if (statusRoute && request.method === 'POST') {
		try {
			const form = await readForm(request);
			const status = (form.status || '').trim();
			if (!validStatuses.includes(status)) {
				sendJson(response, 400, { error: 'Choose a valid appointment status.' });
				return;
			}
			const appointment = appointments.find(item => item.id === Number(statusRoute[1]));
			if (!appointment) {
				sendJson(response, 404, { error: 'Appointment not found.' });
				return;
			}
			appointment.status = status;
			sendJson(response, 200, appointment);
		} catch (error) {
			if (!response.destroyed) sendJson(response, 400, { error: error.message });
		}
		return;
	}

	sendJson(response, 404, { error: 'Endpoint not found.' });
}

function servePage(response, pathname) {
	const files = {
		'/': ['Interface.html', 'text/html; charset=utf-8'],
		'/Interface.html': ['Interface.html', 'text/html; charset=utf-8'],
		'/styles.css': ['styles.css', 'text/css; charset=utf-8']
	};
	const entry = files[pathname];
	if (!entry) {
		response.writeHead(404);
		response.end('Not found');
		return;
	}
	const [filename, contentType] = entry;
	const filePath = path.join(webRoot, filename);
	fs.readFile(filePath, (error, content) => {
		if (error) {
			response.writeHead(404);
			response.end('Not found');
			return;
		}
		response.writeHead(200, {
			'Content-Type': contentType,
			'Content-Length': content.length,
			'X-Content-Type-Options': 'nosniff'
		});
		response.end(content);
	});
}

const server = http.createServer((request, response) => {
	const pathname = new URL(request.url, 'http://localhost').pathname;
	if (pathname.startsWith('/api/')) {
		handleAppointments(request, response, pathname);
		return;
	}
	if (request.method !== 'GET') {
		response.writeHead(405, { Allow: 'GET' });
		response.end('Method not allowed');
		return;
	}
	servePage(response, pathname);
});

server.listen(port, () => {
	console.log(`Fern Dental is ready at http://localhost:${port}`);
});