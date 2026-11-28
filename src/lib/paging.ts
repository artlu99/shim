// Walk hub / gateway pages until `maxMessages` or the server runs dry.
// pageSize is the page request size, not the caller's cap. An empty page
// ends the walk even when a token is attached — a non-advancing token
// would otherwise spin to the cap. Token type is generic (string for the
// haatz /v1 gateway); empty token means "end".
export const collectPagedMessages = async <T, Token extends { length: number }>(
	fetchPage: (request: {
		pageToken?: Token;
		pageSize: number;
	}) => Promise<{ messages: T[]; nextPageToken?: Token }>,
	maxMessages: number,
	pageSize: number,
): Promise<T[]> => {
	if (maxMessages <= 0 || pageSize <= 0) {
		return [];
	}

	const collected: T[] = [];
	let pageToken: Token | undefined;

	while (collected.length < maxMessages) {
		const requestSize = Math.min(pageSize, maxMessages - collected.length);
		const page = await fetchPage({ pageToken, pageSize: requestSize });
		if (page.messages.length === 0) {
			break;
		}

		collected.push(...page.messages.slice(0, maxMessages - collected.length));
		if (collected.length >= maxMessages) {
			break;
		}

		pageToken =
			page.nextPageToken && page.nextPageToken.length > 0
				? page.nextPageToken
				: undefined;
		if (!pageToken) {
			break;
		}
	}

	return collected;
};
