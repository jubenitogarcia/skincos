import json
import mimetypes
import os
from datetime import datetime
from typing import Callable, List, Optional, Sequence, Tuple
from urllib.parse import urljoin, urlparse

import aiohttp

from python.helpers.vector_db import VectorDB

os.environ["USER_AGENT"] = "@mixedbread-ai/unstructured"  # noqa E402
from langchain_unstructured import UnstructuredLoader  # noqa E402

from langchain_community.document_loaders.pdf import PyMuPDFLoader
from langchain_community.document_transformers import MarkdownifyTransformer
from langchain_community.document_loaders.parsers.images import TesseractBlobParser

from langchain_core.documents import Document
from langchain.schema import SystemMessage, HumanMessage

from python.helpers.print_style import PrintStyle
from python.helpers import files, errors
from python.helpers.network_policy import (
    PinnedResolver,
    RemoteDocumentTarget,
    resolve_remote_document_target,
    validate_remote_document_url,
)
from agent import Agent

from langchain.text_splitter import RecursiveCharacterTextSplitter


DEFAULT_SEARCH_THRESHOLD = 0.5
MAX_REMOTE_DOCUMENT_BYTES = 50 * 1024 * 1024


def _response_headers(response: aiohttp.ClientResponse) -> dict[str, str]:
    return {str(key).lower(): str(value) for key, value in response.headers.items()}


async def _read_remote_body(
    response: aiohttp.ClientResponse,
    max_bytes: int = MAX_REMOTE_DOCUMENT_BYTES,
) -> bytes:
    content_length = response.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > max_bytes:
                raise ValueError("Remote document content exceeds 50MB")
        except ValueError as exc:
            if "exceeds 50MB" in str(exc):
                raise
            raise ValueError("Remote document content-length is invalid") from exc

    chunks: list[bytes] = []
    total = 0
    async for chunk in response.content.iter_chunked(64 * 1024):
        total += len(chunk)
        if total > max_bytes:
            raise ValueError("Remote document content exceeds 50MB")
        chunks.append(chunk)
    return b"".join(chunks)


async def _request_remote_document(
    target: RemoteDocumentTarget,
    method: str,
) -> tuple[int, dict[str, str], bytes]:
    """Perform one request through the addresses approved for ``target``."""
    connector = aiohttp.TCPConnector(
        resolver=PinnedResolver(target),
        use_dns_cache=False,
    )
    try:
        async with aiohttp.ClientSession(
            connector=connector,
            timeout=aiohttp.ClientTimeout(total=10.0),
            raise_for_status=False,
        ) as session:
            async with session.request(
                method,
                target.uri,
                allow_redirects=False,
            ) as response:
                headers = _response_headers(response)
                body = b"" if method == "HEAD" else await _read_remote_body(response)
                return response.status, headers, body
    finally:
        await connector.close()


async def fetch_remote_document(document_uri: str) -> tuple[bytes, int, dict[str, str]]:
    """Fetch content through a DNS-pinned, non-redirecting transport."""
    target = resolve_remote_document_target(document_uri)
    status, headers, body = await _request_remote_document(target, "GET")
    if 300 <= status < 400:
        raise ValueError("Remote document redirects must be resolved before download")
    return body, status, headers


async def resolve_remote_document_url(
    document_uri: str,
) -> tuple[str, int, dict[str, str]]:
    """Resolve a short redirect chain while validating every destination."""
    current = validate_remote_document_url(document_uri)
    for _ in range(5):
        target = resolve_remote_document_target(current)
        status, headers, _body = await _request_remote_document(target, "HEAD")
        if status not in {301, 302, 303, 307, 308}:
            return current, status, headers
        location = headers.get("location")
        if not location:
            raise ValueError("Remote document redirect has no location")
        current = validate_remote_document_url(urljoin(current, location))
    raise ValueError("Remote document redirect chain is too long")


class DocumentQueryStore:
    """
    FAISS Store for document query results.
    Manages documents identified by URI for storage, retrieval, and searching.
    """

    # Default chunking parameters
    DEFAULT_CHUNK_SIZE = 1000
    DEFAULT_CHUNK_OVERLAP = 100

    # Cache for initialized stores
    _stores: dict[str, "DocumentQueryStore"] = {}

    @staticmethod
    def get(agent: Agent):
        """Create a DocumentQueryStore instance for the specified agent."""
        if not agent or not agent.config:
            raise ValueError("Agent and agent config must be provided")

        # Initialize store
        store = DocumentQueryStore(agent)
        return store

    def __init__(
        self,
        agent: Agent,
    ):
        """Initialize a DocumentQueryStore instance."""
        self.agent = agent
        self.vector_db: VectorDB | None = None

    @staticmethod
    def normalize_uri(uri: str) -> str:
        """
        Normalize a document URI to ensure consistent lookup.

        Args:
            uri: The URI to normalize

        Returns:
            Normalized URI
        """
        # Convert to lowercase
        normalized = uri.strip()  # uri.lower()

        # Parse the URL to get scheme
        parsed = urlparse(normalized)
        scheme = parsed.scheme or "file"

        # Normalize based on scheme
        if scheme == "file":
            path = files.fix_dev_path(
                normalized.removeprefix("file://").removeprefix("file:")
            )
            normalized = f"file://{path}"

        elif scheme in ["http", "https"]:
            # Always use https for web URLs
            normalized = normalized.replace("http://", "https://")

        return normalized

    def init_vector_db(self):
        return VectorDB(self.agent, cache=True)

    async def add_document(
        self, text: str, document_uri: str, metadata: dict | None = None
    ) -> tuple[bool, list[str]]:
        """
        Add a document to the store with the given URI.

        Args:
            text: The document text content
            document_uri: The URI that uniquely identifies this document
            metadata: Optional metadata for the document

        Returns:
            True if successful, False otherwise
        """
        # Normalize the URI
        document_uri = self.normalize_uri(document_uri)

        # Delete existing document if it exists to avoid duplicates
        await self.delete_document(document_uri)

        # Initialize metadata
        doc_metadata = metadata or {}
        doc_metadata["document_uri"] = document_uri
        doc_metadata["timestamp"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Split text into chunks
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.DEFAULT_CHUNK_SIZE, chunk_overlap=self.DEFAULT_CHUNK_OVERLAP
        )
        chunks = text_splitter.split_text(text)

        # Create documents
        docs = []
        for i, chunk in enumerate(chunks):
            chunk_metadata = doc_metadata.copy()
            chunk_metadata["chunk_index"] = i
            chunk_metadata["total_chunks"] = len(chunks)
            docs.append(Document(page_content=chunk, metadata=chunk_metadata))

        if not docs:
            PrintStyle.error(f"No chunks created for document: {document_uri}")
            return False, []

        # Apply rate limiter
        try:
            docs_text = "".join(chunk.page_content for chunk in docs)
            await self.agent.rate_limiter(
                model_config=self.agent.config.embeddings_model, input=docs_text
            )

            # Initialize vector db if not already initialized
            if not self.vector_db:
                self.vector_db = self.init_vector_db()

            ids = await self.vector_db.insert_documents(docs)
            PrintStyle.standard(
                f"Added document '{document_uri}' with {len(docs)} chunks"
            )
            return True, ids
        except Exception as e:
            err_text = errors.format_error(e)
            PrintStyle.error(f"Error adding document '{document_uri}': {err_text}")
            return False, []

    async def get_document(self, document_uri: str) -> Optional[Document]:
        """
        Retrieve a document by its URI.

        Args:
            document_uri: The URI of the document to retrieve

        Returns:
            The complete document if found, None otherwise
        """

        # DB not initialized, no documents inside
        if not self.vector_db:
            return None

        # Normalize the URI
        document_uri = self.normalize_uri(document_uri)

        # Get all chunks for this document
        docs = await self._get_document_chunks(document_uri)
        if not docs:
            PrintStyle.error(f"Document not found: {document_uri}")
            return None

        # Combine chunks into a single document
        chunks = sorted(docs, key=lambda x: x.metadata.get("chunk_index", 0))
        full_content = "\n".join(chunk.page_content for chunk in chunks)

        # Use metadata from first chunk
        metadata = chunks[0].metadata.copy()
        metadata.pop("chunk_index", None)
        metadata.pop("total_chunks", None)

        return Document(page_content=full_content, metadata=metadata)

    async def _get_document_chunks(self, document_uri: str) -> List[Document]:
        """
        Get all chunks for a document.

        Args:
            document_uri: The URI of the document

        Returns:
            List of document chunks
        """

        # DB not initialized, no documents inside
        if not self.vector_db:
            return []

        # Normalize the URI
        document_uri = self.normalize_uri(document_uri)

        # get docs from vector db

        chunks = await self.vector_db.search_by_metadata(
            filter=f"document_uri == '{document_uri}'",
        )

        PrintStyle.standard(f"Found {len(chunks)} chunks for document: {document_uri}")
        return chunks

    async def document_exists(self, document_uri: str) -> bool:
        """
        Check if a document exists in the store.

        Args:
            document_uri: The URI of the document to check

        Returns:
            True if the document exists, False otherwise
        """

        # DB not initialized, no documents inside
        if not self.vector_db:
            return False

        # Normalize the URI
        document_uri = self.normalize_uri(document_uri)

        chunks = await self._get_document_chunks(document_uri)
        return len(chunks) > 0

    async def delete_document(self, document_uri: str) -> bool:
        """
        Delete a document from the store.

        Args:
            document_uri: The URI of the document to delete

        Returns:
            True if deleted, False if not found
        """

        # DB not initialized, no documents inside
        if not self.vector_db:
            return False

        # Normalize the URI
        document_uri = self.normalize_uri(document_uri)

        chunks = await self.vector_db.search_by_metadata(
            filter=f"document_uri == '{document_uri}'",
        )
        if not chunks:
            return False

        # Collect IDs to delete
        ids_to_delete = [chunk.metadata["id"] for chunk in chunks]

        # Delete from vector store
        if ids_to_delete:
            dels = await self.vector_db.delete_documents_by_ids(ids_to_delete)
            PrintStyle.standard(
                f"Deleted document '{document_uri}' with {len(dels)} chunks"
            )
            return True

        return False

    async def search_documents(
        self, query: str, limit: int = 10, threshold: float = 0.5, filter: str = ""
    ) -> List[Document]:
        """
        Search for documents similar to the query across the entire store.

        Args:
            query: The search query string
            limit: Maximum number of results to return
            threshold: Minimum similarity score threshold (0-1)

        Returns:
            List of matching documents
        """

        # DB not initialized, no documents inside
        if not self.vector_db:
            return []

        # Handle empty query
        if not query:
            return []

        # Perform search
        try:
            results = await self.vector_db.search_by_similarity_threshold(
                query=query, limit=limit, threshold=threshold, filter=filter
            )

            PrintStyle.standard(f"Search '{query}' returned {len(results)} results")
            return results
        except Exception as e:
            PrintStyle.error(f"Error searching documents: {str(e)}")
            return []

    async def search_document(
        self, document_uri: str, query: str, limit: int = 10, threshold: float = 0.5
    ) -> List[Document]:
        """
        Search for content within a specific document.

        Args:
            document_uri: The URI of the document to search within
            query: The search query string
            limit: Maximum number of results to return
            threshold: Minimum similarity score threshold (0-1)

        Returns:
            List of matching document chunks
        """
        return await self.search_documents(
            query, limit, threshold, f"document_uri == '{document_uri}'"
        )

    async def list_documents(self) -> List[str]:
        """
        Get a list of all document URIs in the store.

        Returns:
            List of document URIs
        """
        # DB not initialized, no documents inside
        if not self.vector_db:
            return []

        # Extract unique URIs
        uris = set()
        for doc in self.vector_db.db.get_all_docs().values():
            if isinstance(doc.metadata, dict):
                uri = doc.metadata.get("document_uri")
                if uri:
                    uris.add(uri)

        return sorted(list(uris))


class DocumentQueryHelper:

    def __init__(
        self, agent: Agent, progress_callback: Callable[[str], None] | None = None
    ):
        self.agent = agent
        self.store = DocumentQueryStore.get(agent)
        self.progress_callback = progress_callback or (lambda x: None)

    async def document_qa(
        self, document_uri: str, questions: Sequence[str]
    ) -> Tuple[bool, str]:
        self.progress_callback(f"Starting Q&A process")

        # index document
        _ = await self.document_get_content(document_uri, True)
        selected_chunks = {}
        for question in questions:
            self.progress_callback(f"Optimizing query: {question}")
            human_content = f'Search Query: "{question}"'
            system_content = self.agent.parse_prompt(
                "fw.document_query.optmimize_query.md"
            )

            optimized_query = (
                await self.agent.call_utility_model(
                    system=system_content, message=human_content
                )
            ).strip()

            self.progress_callback(f"Searching document with query: {optimized_query}")

            normalized_uri = self.store.normalize_uri(document_uri)
            chunks = await self.store.search_document(
                document_uri=normalized_uri,
                query=optimized_query,
                limit=100,
                threshold=DEFAULT_SEARCH_THRESHOLD,
            )

            self.progress_callback(f"Found {len(chunks)} chunks")

            for chunk in chunks:
                selected_chunks[chunk.metadata["id"]] = chunk

        if not selected_chunks:
            self.progress_callback(f"No relevant content found in the document")
            content = f"!!! No content found for document: {document_uri} matching queries: {json.dumps(questions)}"
            return False, content

        self.progress_callback(
            f"Processing {len(questions)} questions in context of {len(selected_chunks)} chunks"
        )

        questions_str = "\n".join([f" *  {question}" for question in questions])
        content = "\n\n----\n\n".join(
            [chunk.page_content for chunk in selected_chunks.values()]
        )

        qa_system_message = self.agent.parse_prompt(
            "fw.document_query.system_prompt.md"
        )
        qa_user_message = f"# Document:\n{content}\n\n# Queries:\n{questions_str}"

        ai_response, _reasoning = await self.agent.call_chat_model(
            messages=[
                SystemMessage(content=qa_system_message),
                HumanMessage(content=qa_user_message),
            ]
        )

        self.progress_callback(f"Q&A process completed")

        return True, str(ai_response)

    async def document_get_content(
        self, document_uri: str, add_to_db: bool = False
    ) -> str:
        self.progress_callback(f"Fetching document content")
        original_document_uri = document_uri
        url = urlparse(original_document_uri)
        scheme = url.scheme or "file"
        mimetype, encoding = mimetypes.guess_type(original_document_uri)
        mimetype = mimetype or "application/octet-stream"
        fetch_document_uri = original_document_uri
        index_document_uri = original_document_uri

        if scheme in {"http", "https"}:
            # Validate before handing the URL to any loader. The resolved
            # public URL is used only for fetching; the caller's URI remains
            # the stable index key after a legitimate cross-host redirect.
            try:
                fetch_document_uri, response_status, response_headers = (
                    await resolve_remote_document_url(original_document_uri)
                )
            except Exception as exc:
                raise ValueError(
                    f"DocumentQueryHelper::document_get_content: Document fetch error: {original_document_uri} ({exc})"
                ) from exc

            if response_status > 399:
                raise ValueError(
                    f"DocumentQueryHelper::document_get_content: Document fetch error: {fetch_document_uri} ({response_status})"
                )

            if mimetype == "application/octet-stream":
                mimetype = response_headers.get("content-type", "")
            if "content-length" in response_headers:
                content_length = (
                    float(response_headers["content-length"]) / 1024 / 1024
                )  # MB
                if content_length > 50.0:
                    raise ValueError(
                        f"Document content length exceeds max. 50MB: {content_length} MB ({fetch_document_uri})"
                    )
            if mimetype and "; charset=" in mimetype:
                mimetype = mimetype.split("; charset=")[0]

        if scheme == "file":
            try:
                document_uri = files.fix_dev_path(url.path)
                fetch_document_uri = document_uri
                index_document_uri = document_uri
            except Exception as e:
                raise ValueError(f"Invalid document path '{url.path}'") from e

        if encoding:
            raise ValueError(
                f"Compressed documents are unsupported '{encoding}' ({document_uri})"
            )

        if mimetype == "application/octet-stream":
            raise ValueError(
                f"Unsupported document mimetype '{mimetype}' ({document_uri})"
            )

        # Use the store's normalization method
        document_uri_norm = self.store.normalize_uri(index_document_uri)

        exists = await self.store.document_exists(document_uri_norm)
        document_content = ""
        if not exists:
            if mimetype.startswith("image/"):
                document_content = await self.handle_image_document(
                    fetch_document_uri, scheme
                )
            elif mimetype == "text/html":
                document_content = await self.handle_html_document(
                    fetch_document_uri, scheme
                )
            elif mimetype.startswith("text/") or mimetype == "application/json":
                document_content = await self.handle_text_document(
                    fetch_document_uri, scheme
                )
            elif mimetype == "application/pdf":
                document_content = await self.handle_pdf_document(
                    fetch_document_uri, scheme
                )
            else:
                document_content = await self.handle_unstructured_document(
                    fetch_document_uri, scheme
                )
            if add_to_db:
                self.progress_callback(f"Indexing document")
                success, ids = await self.store.add_document(
                    document_content, document_uri_norm
                )
                if not success:
                    self.progress_callback(f"Failed to index document")
                    raise ValueError(
                        f"DocumentQueryHelper::document_get_content: Failed to index document: {document_uri_norm}"
                    )
                self.progress_callback(f"Indexed {len(ids)} chunks")
        else:
            doc = await self.store.get_document(document_uri_norm)
            if doc:
                document_content = doc.page_content
            else:
                raise ValueError(
                    f"DocumentQueryHelper::document_get_content: Document not found: {document_uri_norm}"
                )
        return document_content

    async def handle_image_document(self, document: str, scheme: str) -> str:
        return await self.handle_unstructured_document(document, scheme)

    async def handle_html_document(self, document: str, scheme: str) -> str:
        if scheme in ["http", "https"]:
            body, status, headers = await fetch_remote_document(document)
            if status != 200:
                raise ValueError(
                    f"DocumentQueryHelper::handle_html_document: Failed to download document from {document}: {status}"
                )
            charset = "utf-8"
            content_type = headers.get("content-type", "")
            if "charset=" in content_type:
                charset = (
                    content_type.split("charset=", 1)[1]
                    .split(";", 1)[0]
                    .strip()
                    or charset
                )
            try:
                decoded = body.decode(charset, errors="replace")
            except LookupError:
                decoded = body.decode("utf-8", errors="replace")
            parts = [Document(page_content=decoded, metadata={"source": document})]
        elif scheme == "file":
            # Use RFC file operations instead of TextLoader
            file_content_bytes = files.read_file_bin(document)
            file_content = file_content_bytes.decode("utf-8")
            # Create Document manually since we're not using TextLoader
            parts = [Document(page_content=file_content, metadata={"source": document})]
        else:
            raise ValueError(f"Unsupported scheme: {scheme}")

        return "\n".join(
            [
                element.page_content
                for element in MarkdownifyTransformer().transform_documents(parts)
            ]
        )

    async def handle_text_document(self, document: str, scheme: str) -> str:
        if scheme in ["http", "https"]:
            body, status, headers = await fetch_remote_document(document)
            if status != 200:
                raise ValueError(
                    f"DocumentQueryHelper::handle_text_document: Failed to download document from {document}: {status}"
                )
            charset = "utf-8"
            content_type = headers.get("content-type", "")
            if "charset=" in content_type:
                charset = (
                    content_type.split("charset=", 1)[1]
                    .split(";", 1)[0]
                    .strip()
                    or charset
                )
            try:
                decoded = body.decode(charset, errors="replace")
            except LookupError:
                decoded = body.decode("utf-8", errors="replace")
            elements = [Document(page_content=decoded, metadata={"source": document})]
        elif scheme == "file":
            # Use RFC file operations instead of TextLoader
            file_content_bytes = files.read_file_bin(document)
            file_content = file_content_bytes.decode("utf-8")
            # Create Document manually since we're not using TextLoader
            elements = [
                Document(page_content=file_content, metadata={"source": document})
            ]
        else:
            raise ValueError(f"Unsupported scheme: {scheme}")

        return "\n".join([element.page_content for element in elements])

    async def handle_pdf_document(self, document: str, scheme: str) -> str:
        temp_file_path = ""
        if scheme == "file":
            # Use RFC file operations to read the PDF file as binary
            file_content_bytes = files.read_file_bin(document)
            # Create a temporary file for PyMuPDFLoader since it needs a file path
            import tempfile

            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
                temp_file.write(file_content_bytes)
                temp_file_path = temp_file.name
        elif scheme in ["http", "https"]:
            body, status, _headers = await fetch_remote_document(document)
            if status != 200:
                raise ValueError(
                    f"DocumentQueryHelper::handle_pdf_document: Failed to download PDF from {document}: {status}"
                )
            import tempfile

            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
                temp_file.write(body)
                temp_file_path = temp_file.name
        else:
            raise ValueError(f"Unsupported scheme: {scheme}")

        if not os.path.exists(temp_file_path):
            raise ValueError(
                f"DocumentQueryHelper::handle_pdf_document: Temporary file not found: {temp_file_path}"
            )

        try:
            try:
                loader = PyMuPDFLoader(
                    temp_file_path,
                    mode="single",
                    extract_tables="markdown",
                    extract_images=True,
                    images_inner_format="text",
                    images_parser=TesseractBlobParser(),
                    pages_delimiter="\n",
                )
                elements: list[Document] = loader.load()
                contents = "\n".join([element.page_content for element in elements])
            except Exception as e:
                PrintStyle.error(
                    f"DocumentQueryHelper::handle_pdf_document: Error loading with PyMuPDF: {e}"
                )
                contents = ""

            if not contents:
                import pdf2image
                import pytesseract

                PrintStyle.debug(
                    f"DocumentQueryHelper::handle_pdf_document: FALLBACK Converting PDF to images: {temp_file_path}"
                )

                # Convert PDF to images
                pages = pdf2image.convert_from_path(temp_file_path)  # type: ignore
                for page in pages:
                    contents += pytesseract.image_to_string(page) + "\n\n"

            return contents
        finally:
            os.unlink(temp_file_path)

    async def handle_unstructured_document(self, document: str, scheme: str) -> str:
        elements: list[Document] = []
        if scheme in ["http", "https"]:
            body, status, headers = await fetch_remote_document(document)
            if status != 200:
                raise ValueError(
                    f"DocumentQueryHelper::handle_unstructured_document: Failed to download document from {document}: {status}"
                )
            import tempfile

            content_type = headers.get("content-type", "").split(";", 1)[0].strip()
            suffix = os.path.splitext(urlparse(document).path)[1]
            if not suffix:
                suffix = mimetypes.guess_extension(content_type) or ".bin"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
                temp_file.write(body)
                temp_file_path = temp_file.name
            try:
                loader = UnstructuredLoader(
                    file_path=temp_file_path,
                    mode="single",
                    partition_via_api=False,
                    # chunking_strategy="by_page",
                    strategy="hi_res",
                )
                elements = loader.load()
            finally:
                os.unlink(temp_file_path)
        elif scheme == "file":
            # Use RFC file operations to read the file as binary
            file_content_bytes = files.read_file_bin(document)
            # Create a temporary file for UnstructuredLoader since it needs a file path
            import tempfile
            import os

            # Get file extension to preserve it for proper processing
            _, ext = os.path.splitext(document)
            with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as temp_file:
                temp_file.write(file_content_bytes)
                temp_file_path = temp_file.name

            try:
                loader = UnstructuredLoader(
                    file_path=temp_file_path,
                    mode="single",
                    partition_via_api=False,
                    # chunking_strategy="by_page",
                    strategy="hi_res",
                )
                elements = loader.load()
            finally:
                # Clean up temporary file
                os.unlink(temp_file_path)
        else:
            raise ValueError(f"Unsupported scheme: {scheme}")

        return "\n".join([element.page_content for element in elements])
