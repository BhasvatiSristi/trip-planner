const form = document.getElementById('trip-form');
const formError = document.getElementById('form-error');
const submitButton = document.getElementById('submit-trip');
const loadingState = document.getElementById('loading-state');
const resultsSection = document.getElementById('results');
const resultsTitle = document.getElementById('results-title');
const resultsSummary = document.getElementById('results-summary');
const resultsMeta = document.getElementById('results-meta');
const resultsGrid = document.getElementById('results-grid');

const storageKey = 'trip-planner-thread-id';
const state = {
	threadId: sessionStorage.getItem(storageKey) || '',
	isLoading: false,
};

const sectionTitles = new Set([
	'trip summary',
	'flight information',
	'hotel suggestions',
	'day-by-day itinerary',
	'estimated budget',
	'final recommendations',
	'destination information',
	'recommended activities',
	'travel tips',
	'budget information',
	'suggested itinerary',
	'ai recommendations',
	'overview',
]);

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function safeLink(url) {
	try {
		const parsed = new URL(url, window.location.origin);
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
			return parsed.href;
		}
	} catch (error) {
		return null;
	}

	return null;
}

function renderInlineMarkdown(text) {
	const escaped = escapeHtml(text);

	return escaped
		.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
		.replace(/\*(.+?)\*/g, '<em>$1</em>')
		.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
			const safeUrl = safeLink(url);
			if (!safeUrl) {
				return label;
			}

			return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
		});
}

function renderMarkdownBlock(text) {
	const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
	const html = [];
	let activeList = null;

	const closeList = () => {
		if (activeList) {
			html.push(`</${activeList}>`);
			activeList = null;
		}
	};

	for (const line of lines) {
		const trimmed = line.trim();

		if (!trimmed) {
			closeList();
			continue;
		}

		const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
		if (headingMatch) {
			closeList();
			html.push(`<h4>${renderInlineMarkdown(headingMatch[2])}</h4>`);
			continue;
		}

		const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
		if (bulletMatch) {
			if (activeList !== 'ul') {
				closeList();
				html.push('<ul>');
				activeList = 'ul';
			}
			html.push(`<li>${renderInlineMarkdown(bulletMatch[1])}</li>`);
			continue;
		}

		const numberedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
		if (numberedMatch) {
			if (activeList !== 'ol') {
				closeList();
				html.push('<ol>');
				activeList = 'ol';
			}
			html.push(`<li>${renderInlineMarkdown(numberedMatch[1])}</li>`);
			continue;
		}

		closeList();
		html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
	}

	closeList();
	return html.join('');
}

function showError(message) {
	formError.textContent = message;
	formError.hidden = !message;
}

function setLoading(isLoading) {
	state.isLoading = isLoading;
	submitButton.disabled = isLoading;
	submitButton.classList.toggle('is-loading', isLoading);
	loadingState.hidden = !isLoading;
	resultsSection.hidden = false;
	resultsSection.setAttribute('aria-busy', String(isLoading));
}

function getFieldValue(id) {
	const element = document.getElementById(id);
	return element ? element.value.trim() : '';
}

function getSelectedInterests() {
	return Array.from(form.querySelectorAll('input[name="interest"]:checked'))
		.map((input) => input.value)
		.filter(Boolean);
}

function formatDate(value) {
	if (!value) {
		return 'Open-ended';
	}

	const parsed = new Date(`${value}T00:00:00`);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}

	return parsed.toLocaleDateString(undefined, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
	});
}

function buildTripMessage(values) {
	const lines = [
		'Plan a trip with these details:',
		`Origin: ${values.origin}`,
		`Destination: ${values.destination}`,
		`Departure date: ${values.departureDate}`,
		`Return date: ${values.returnDate || 'Open-ended'}`,
		`Travelers: ${values.travelers}`,
		`Budget: ${values.budget}`,
		`Travel interests: ${values.interests.length ? values.interests.join(', ') : 'None specified'}`,
	];

	if (values.requests) {
		lines.push(`Additional requests: ${values.requests}`);
	}

	return lines.join('\n');
}

function collectFormValues() {
	return {
		origin: getFieldValue('origin'),
		destination: getFieldValue('destination'),
		departureDate: getFieldValue('departure-date'),
		returnDate: getFieldValue('return-date'),
		travelers: getFieldValue('travelers') || '1',
		budget: getFieldValue('budget') || 'Flexible',
		interests: getSelectedInterests(),
		requests: getFieldValue('requests'),
	};
}

function validateForm(values) {
	if (!values.origin) {
		return 'Please enter an origin city, airport, or country.';
	}

	if (!values.destination) {
		return 'Please enter a destination city, airport, or country.';
	}

	if (!values.departureDate) {
		return 'Please choose a departure date.';
	}

	if (values.returnDate && values.returnDate < values.departureDate) {
		return 'The return date must be on or after the departure date.';
	}

	return '';
}

function normalizeHeading(line) {
	return line
		.trim()
		.replace(/^#{1,6}\s*/, '')
		.replace(/^\d+\.\s*/, '')
		.replace(/[:\s-]+$/g, '')
		.toLowerCase();
}

function splitAnswerSections(text) {
	const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
	const sections = [];
	let currentSection = null;

	for (const line of lines) {
		const heading = normalizeHeading(line);
		if (sectionTitles.has(heading)) {
			if (currentSection) {
				sections.push(currentSection);
			}

			currentSection = {
				title: line.replace(/^#{1,6}\s*/, '').replace(/^\d+\.\s*/, '').replace(/[:\s-]+$/g, '').trim(),
				content: [],
			};
			continue;
		}

		if (currentSection) {
			currentSection.content.push(line);
		}
	}

	if (currentSection) {
		sections.push(currentSection);
	}

	return sections.filter((section) => section.content.join('\n').trim());
}

function parseFlightBlock(block) {
	const flight = {
		airline: 'Unknown airline',
		flightNumber: 'Unknown flight',
		status: 'Unknown',
		departure: {},
		arrival: {},
	};

	let currentSection = null;

	for (const rawLine of block.split('\n')) {
		const line = rawLine.trim();

		if (!line) {
			continue;
		}

		if (line.startsWith('Airline:')) {
			flight.airline = line.replace('Airline:', '').trim() || flight.airline;
			continue;
		}

		if (line.startsWith('Flight:')) {
			flight.flightNumber = line.replace('Flight:', '').trim() || flight.flightNumber;
			continue;
		}

		if (line.startsWith('Status:')) {
			flight.status = line.replace('Status:', '').trim() || flight.status;
			continue;
		}

		if (line === 'Departure:') {
			currentSection = 'departure';
			continue;
		}

		if (line === 'Arrival:') {
			currentSection = 'arrival';
			continue;
		}

		const fieldMatch = line.match(/^[-•]?\s*([^:]+):\s*(.*)$/);
		if (fieldMatch && currentSection) {
			const fieldName = fieldMatch[1].trim().toLowerCase();
			const fieldValue = fieldMatch[2].trim();
			flight[currentSection][fieldName] = fieldValue;
		}
	}

	return flight;
}

function parseFlights(text) {
	const trimmed = String(text || '').trim();

	if (!trimmed) {
		return { notice: 'No flight information was returned by the backend.' };
	}

	if (/^Flight API error:/i.test(trimmed) || /^No live flight data found/i.test(trimmed)) {
		return { notice: trimmed };
	}

	const flightSectionIndex = trimmed.indexOf('Airline:');
	if (flightSectionIndex === -1) {
		return { notice: trimmed };
	}

	const routeInfo = trimmed.slice(0, flightSectionIndex).trim();
	const flightBlocks = trimmed
		.slice(flightSectionIndex)
		.split(/\n\s*---\s*\n/g)
		.map((block) => block.trim())
		.filter(Boolean)
		.map(parseFlightBlock);

	return {
		routeInfo,
		flights: flightBlocks,
	};
}

function parseHotelResults(text) {
	const trimmed = String(text || '').trim();
	if (!trimmed) {
		return [];
	}

	return trimmed
		.split(/\n\s*\n(?=\d+\.\s+\*\*)/g)
		.map((block) => block.trim())
		.filter(Boolean)
		.map((block) => {
			const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
			const titleMatch = lines[0] ? lines[0].match(/^\d+\.\s+\*\*(.+?)\*\*$/) : null;

			return {
				title: titleMatch ? titleMatch[1].trim() : lines[0] || 'Hotel result',
				url: lines[1] || '',
				snippet: lines.slice(2).join(' '),
			};
		});
}

function parseItinerary(text) {
	const trimmed = String(text || '').trim();
	if (!trimmed) {
		return { raw: '', days: [] };
	}

	const lines = trimmed.replace(/\r\n/g, '\n').split('\n');
	const days = [];
	let currentDay = null;
	let currentSlot = null;

	const pushCurrentDay = () => {
		if (currentDay) {
			days.push(currentDay);
		}
	};

	for (const rawLine of lines) {
		const line = rawLine.trim();

		if (!line) {
			continue;
		}

		const dayMatch = line.match(/^(?:day\s*)?(\d+)(?:\s*[:\-\.]\s*(.*))?$/i);
		if (dayMatch && /day/i.test(line)) {
			pushCurrentDay();
			currentDay = {
				label: `Day ${dayMatch[1]}`,
				title: dayMatch[2] ? dayMatch[2].trim() : '',
				slots: {},
				notes: [],
			};
			currentSlot = null;
			continue;
		}

		const slotMatch = line.match(/^(morning|afternoon|evening|night)\s*[:\-]\s*(.*)$/i);
		if (slotMatch && currentDay) {
			currentSlot = slotMatch[1].toLowerCase();
			currentDay.slots[currentSlot] = slotMatch[2].trim();
			continue;
		}

		if (currentDay) {
			if (currentSlot && currentDay.slots[currentSlot]) {
				currentDay.slots[currentSlot] += ` ${line}`;
			} else {
				currentDay.notes.push(line);
			}
		}
	}

	pushCurrentDay();

	if (!days.length) {
		return { raw: trimmed, days: [] };
	}

	return {
		raw: trimmed,
		days,
	};
}

function createCard(title, subtitle) {
	const card = document.createElement('article');
	card.className = 'result-card';

	const header = document.createElement('div');
	header.className = 'result-card-header';

	const heading = document.createElement('h3');
	heading.textContent = title;
	header.appendChild(heading);

	if (subtitle) {
		const pill = document.createElement('span');
		pill.className = 'result-pill';
		pill.textContent = subtitle;
		header.appendChild(pill);
	}

	const body = document.createElement('div');
	body.className = 'result-card-body';

	card.append(header, body);
	return { card, body };
}

function addMetaPill(text) {
	const pill = document.createElement('span');
	pill.className = 'meta-pill';
	pill.textContent = text;
	resultsMeta.appendChild(pill);
}

function renderOverview(values) {
	const { card, body } = createCard(
		'Trip overview',
		'At a glance'
	);

	const summaryGrid = document.createElement('div');
	summaryGrid.className = 'summary-grid';

	const items = [
		{
			label: 'Route',
			value: `${values.origin} → ${values.destination}`,
		},
		{
			label: 'Travel window',
			value: `${formatDate(values.departureDate)}${
				values.returnDate
					? ` to ${formatDate(values.returnDate)}`
					: ''
			}`,
		},
		{
			label: 'Travelers',
			value: values.travelers,
		},
		{
			label: 'Budget',
			value: values.budget,
		},
	];

	for (const item of items) {
		const summaryItem = document.createElement('div');
		summaryItem.className = 'summary-item';

		summaryItem.innerHTML = `
			<span>${escapeHtml(item.label)}</span>
			<strong>${escapeHtml(item.value)}</strong>
		`;

		summaryGrid.appendChild(summaryItem);
	}

	body.appendChild(summaryGrid);

	return card;
}

function renderAnswerCard(answer) {
	const { card, body } = createCard('AI response', 'Readable trip plan');
	const sections = splitAnswerSections(answer);

	if (!answer || !answer.trim()) {
		body.innerHTML = '<div class="empty-state">The backend returned no final answer text.</div>';
		return card;
	}

	if (!sections.length) {
		const content = document.createElement('div');
		content.className = 'rich-text';
		content.innerHTML = renderMarkdownBlock(answer);
		body.appendChild(content);
		return card;
	}

	const stack = document.createElement('div');
	stack.className = 'section-stack';

	for (const section of sections) {
		const block = document.createElement('section');
		block.className = 'result-card';
		block.style.boxShadow = 'none';
		block.style.border = '1px solid rgba(40, 39, 35, 0.08)';
		block.style.background = 'rgba(255, 255, 255, 0.7)';

		const heading = document.createElement('div');
		heading.className = 'result-card-header';
		heading.innerHTML = `<h3>${escapeHtml(section.title)}</h3>`;

		const sectionBody = document.createElement('div');
		sectionBody.className = 'result-card-body rich-text';
		sectionBody.innerHTML = renderMarkdownBlock(section.content.join('\n').trim());

		block.append(heading, sectionBody);
		stack.appendChild(block);
	}

	body.appendChild(stack);
	return card;
}

function renderFlightsCard(flightText) {
	const parsed = parseFlights(flightText);
	const { card, body } = createCard('Flight information', 'Live status');

	if (parsed.notice) {
		body.innerHTML = `<div class="empty-state">${renderInlineMarkdown(parsed.notice)}</div>`;
		return card;
	}

	const stack = document.createElement('div');
	stack.className = 'section-stack';

	if (parsed.routeInfo) {
		const route = document.createElement('div');
		route.className = 'success-banner';
		route.textContent = parsed.routeInfo;
		stack.appendChild(route);
	}

	const flightGrid = document.createElement('div');
	flightGrid.className = 'flight-grid';

	for (const flight of parsed.flights || []) {
		const cardNode = document.createElement('article');
		cardNode.className = 'flight-card';

		const top = document.createElement('div');
		top.className = 'flight-card-top';

		const titleWrap = document.createElement('div');
		titleWrap.innerHTML = `
			<h4>${escapeHtml(flight.airline)}</h4>
			<p class="flight-subtitle">${escapeHtml(flight.flightNumber)} • ${escapeHtml(flight.status)}</p>
		`;
		top.appendChild(titleWrap);

		const routePill = document.createElement('span');
		routePill.className = 'result-pill';
		routePill.textContent = `${flight.departure?.iata || 'DEP'} → ${flight.arrival?.iata || 'ARR'}`;
		top.appendChild(routePill);

		const details = document.createElement('div');
		details.className = 'flight-details';

		const detailItems = [
			['Departure airport', flight.departure?.airport],
			['Departure time', flight.departure?.scheduled],
			['Departure terminal', flight.departure?.terminal],
			['Departure gate', flight.departure?.gate],
			['Arrival airport', flight.arrival?.airport],
			['Arrival time', flight.arrival?.scheduled],
			['Arrival terminal', flight.arrival?.terminal],
			['Arrival gate', flight.arrival?.gate],
			['Departure delay', flight.departure?.delay ? `${flight.departure.delay}` : 'N/A'],
			['Arrival delay', flight.arrival?.delay ? `${flight.arrival.delay}` : 'N/A'],
		];

		for (const [label, value] of detailItems) {
			const row = document.createElement('div');
			row.className = 'detail-row';
			row.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value || 'N/A')}</strong>`;
			details.appendChild(row);
		}

		cardNode.append(top, details);
		flightGrid.appendChild(cardNode);
	}

	stack.appendChild(flightGrid);
	body.appendChild(stack);
	return card;
}

function renderHotelsCard(hotelText) {
	const hotels = parseHotelResults(hotelText);
	const { card, body } = createCard('Hotel and web research', 'Travel suggestions');

	if (!hotels.length) {
		body.innerHTML = '<div class="empty-state">No hotel or web research results were returned.</div>';
		return card;
	}

	const list = document.createElement('div');
	list.className = 'hotel-list';

	for (const hotel of hotels) {
		const article = document.createElement('article');
		article.className = 'hotel-card';

		const top = document.createElement('div');
		top.className = 'hotel-card-top';

		const title = document.createElement('div');
		title.innerHTML = `<h4>${escapeHtml(hotel.title)}</h4>`;
		top.appendChild(title);

		const pill = document.createElement('span');
		pill.className = 'result-pill';
		pill.textContent = 'Web result';
		top.appendChild(pill);

		const url = document.createElement('p');
		url.className = 'hotel-url';
		if (hotel.url) {
			const safeUrl = safeLink(hotel.url);
			url.innerHTML = safeUrl
				? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(hotel.url)}</a>`
				: escapeHtml(hotel.url);
		}

		const snippet = document.createElement('div');
		snippet.className = 'hotel-snippet rich-text';
		snippet.innerHTML = renderMarkdownBlock(hotel.snippet || '');

		article.append(top, url, snippet);
		list.appendChild(article);
	}

	body.appendChild(list);
	return card;
}

function renderItineraryCard(itineraryText) {
	const parsed = parseItinerary(itineraryText);
	const { card, body } = createCard('Itinerary', 'Day-by-day view');

	if (!parsed.raw) {
		body.innerHTML = '<div class="empty-state">No itinerary was returned.</div>';
		return card;
	}

	if (!parsed.days.length) {
		const content = document.createElement('div');
		content.className = 'rich-text';
		content.innerHTML = renderMarkdownBlock(parsed.raw);
		body.appendChild(content);
		return card;
	}

	const stack = document.createElement('div');
	stack.className = 'itinerary-list';

	for (const day of parsed.days) {
		const dayCard = document.createElement('article');
		dayCard.className = 'itinerary-day';

		const top = document.createElement('div');
		top.className = 'itinerary-day-top';

		const title = document.createElement('div');
		title.innerHTML = `<h4>${escapeHtml(day.label)}${day.title ? `: ${escapeHtml(day.title)}` : ''}</h4>`;
		top.appendChild(title);

		const pill = document.createElement('span');
		pill.className = 'result-pill';
		pill.textContent = `${Object.keys(day.slots).length || 0} time slots`;
		top.appendChild(pill);

		const grid = document.createElement('div');
		grid.className = 'itinerary-day-grid';

		const slotOrder = ['morning', 'afternoon', 'evening', 'night'];
		for (const slotName of slotOrder) {
			if (!day.slots[slotName]) {
				continue;
			}

			const slot = document.createElement('div');
			slot.className = 'itinerary-slot';
			slot.innerHTML = `<strong>${slotName.charAt(0).toUpperCase() + slotName.slice(1)}</strong><div>${renderInlineMarkdown(day.slots[slotName])}</div>`;
			grid.appendChild(slot);
		}

		if (day.notes.length) {
			const notes = document.createElement('div');
			notes.className = 'itinerary-notes rich-text';
			notes.innerHTML = renderMarkdownBlock(day.notes.join('\n'));
			grid.appendChild(notes);
		}

		dayCard.append(top, grid);
		stack.appendChild(dayCard);
	}

	body.appendChild(stack);
	return card;
}

function renderResults(result, values) {
	resultsGrid.innerHTML = '';
	resultsMeta.innerHTML = '';
	resultsSection.hidden = false;

	resultsTitle.textContent = 'Your trip plan is ready';
	resultsSummary.textContent =
		'Your complete AI-generated trip plan is shown below.';

	addMetaPill(
		`Thread ${
			result.thread_id
				? result.thread_id.slice(-8)
				: 'new'
		}`
	);

	addMetaPill(`${result.llm_calls ?? 0} AI steps`);
	addMetaPill(`${values.origin} → ${values.destination}`);

	resultsGrid.append(
		renderOverview(values),
		renderAnswerCard(result.answer)
	);

	resultsSection.scrollIntoView({
		behavior: 'smooth',
		block: 'start',
	});
}

async function handleSubmit(event) {
	event.preventDefault();

	showError('');

	const values = collectFormValues();
	const validationMessage = validateForm(values);
	if (validationMessage) {
		showError(validationMessage);
		return;
	}

	const payload = {
		message: buildTripMessage(values),
		thread_id: state.threadId || null,
	};

	setLoading(true);

	try {
		const response = await fetch('/api/travel', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(payload),
		});

		let data;
		try {
			data = await response.json();
		} catch (parseError) {
			throw new Error('The backend returned an invalid response.');
		}

		if (!response.ok || !data.success) {
			throw new Error(data.error || 'The trip planner could not complete your request.');
		}

		state.threadId = data.thread_id || state.threadId;
		if (state.threadId) {
			sessionStorage.setItem(storageKey, state.threadId);
		}

		renderResults(data, values);
		showError('');
	} catch (error) {
		resultsSection.hidden = false;
		resultsGrid.innerHTML = '';
		resultsMeta.innerHTML = '';
		resultsTitle.textContent = 'Unable to complete the plan';
		resultsSummary.textContent = 'The request failed before the backend could return a usable trip plan.';

		const { card, body } = createCard('Something went wrong');
		body.innerHTML = `<div class="empty-state">${escapeHtml(error.message || 'A network or backend error occurred.')}</div>`;
		resultsGrid.appendChild(card);
		showError(error.message || 'A network or backend error occurred.');
	} finally {
		setLoading(false);
	}
}

form.addEventListener('submit', handleSubmit);

for (const input of form.querySelectorAll('input, select, textarea')) {
	input.addEventListener('input', () => {
		if (formError.hidden) {
			return;
		}

		showError('');
	});
}

resultsSection.hidden = true;
loadingState.hidden = true;
