// PostgREST answers at most 1,000 rows per request and ignores a larger
// `.limit()`, so a query that returns one row per player or per alliance
// loses whole entities in silence once the group grows. This walks pages with
// `.range()` until one comes back short.

const PAGE_SIZE = 1000;

interface Page<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>,
  maxPages = 20,
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < maxPages; index += 1) {
    const from = index * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(error.message);
    }
    const got = data ?? [];
    rows.push(...got);
    if (got.length < PAGE_SIZE) {
      break;
    }
  }
  return rows;
}
