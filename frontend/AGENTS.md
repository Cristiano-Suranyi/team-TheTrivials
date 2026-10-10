<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep the anonymization workspace as a frontend state machine with service-ready boundaries, so the Python API can replace local demo processing without redesigning the interface.
- The integrated session API is implemented in submission/web_api.py. Keep root API.md and frontend/API.md synchronized.
- PDF text is extracted client-side with pdf.js for detection. As explicitly requested by the user, original PDF bytes can be sent to the local Python export endpoint for real redaction while preserving pagination. Never send original PDF bytes to Gemini or persist the original PDF.
