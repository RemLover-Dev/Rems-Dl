import os
import shutil
import tempfile
import pytest
import asyncio

from core.shared import (
    sanitize_path_component,
    sanitize_filename,
    safe_ensure_dir,
    safe_filepath,
    BaseDownloader,
)
from workers.danbooru import DanbooruWorker
from workers.gelbooru import GelbooruWorker
from workers.konachan import KonachanWorker
from workers.yande import YandeWorker
from workers.safebooru import SafebooruWorker
from workers.sankaku import SankakuWorker
from workers.anime_dl import AnimeDlWorker
from workers.eshuushuu import EShuushuuWorker
from workers.rule34 import Rule34Worker
from workers.pixiv import PixivWorker
from workers.nekos_best import NekosBestWorker
from workers.nekos_life import NekosLifeWorker
from workers.nekosapi import NekosApiWorker
from workers.nekosia import NekosiaWorker
from workers.waifu_im import WaifuImWorker
from workers.pinterest_worker import PinterestWorker
from workers.zerochan import ZerochanWorker


class TestPathSanitization:
    @pytest.fixture
    def temp_folder(self):
        folder = tempfile.mkdtemp()
        yield folder
        shutil.rmtree(folder, ignore_errors=True)

    def test_sanitize_path_component_colons_and_prohibited_chars(self, temp_folder):
        cases = [
            ("re:zero", "rezero"),
            ("86: Eighty Six", "86 Eighty Six"),
            ("Uma.Musume:.Pretty.Derby", "Uma.Musume.Pretty.Derby"),
            ("tag?question", "tagquestion"),
            ("tag*star", "tagstar"),
            ("tag<less>greater", "taglessgreater"),
            ("tag|pipe", "tagpipe"),
            ('tag"quote"', "tagquote"),
            ("tag/slash", "tagslash"),
            ("tag\\backslash", "tagbackslash"),
            ("tag\x00\x1fcontrol", "tagcontrol"),
            ("trailing_dot.", "trailing_dot"),
            ("trailing_spaces   ", "trailing_spaces"),
            ("CON", "_CON"),
            ("aux", "_aux"),
            ("prn.txt", "_prn.txt"),
            ("", "misc"),
            ("::::????****", "misc"),
        ]
        for raw, expected in cases:
            cleaned = sanitize_path_component(raw, fallback="misc")
            assert cleaned == expected, f"Failed for raw={raw}: got {cleaned}, expected {expected}"
            # Verify the directory can actually be created and written to on this filesystem
            target_dir = os.path.join(temp_folder, cleaned)
            os.makedirs(target_dir, exist_ok=True)
            assert os.path.isdir(target_dir)

    def test_sanitize_filename(self, temp_folder):
        cases = [
            ("re:zero.jpg", "rezero.jpg"),
            ("tag?name.png", "tagname.png"),
            ("tag*star.webp", "tagstar.webp"),
            ("tag|pipe.mp4", "tagpipe.mp4"),
            ('tag"quote".gif', "tagquote.gif"),
            ("CON.png", "_CON.png"),
            ("aux.jpg", "_aux.jpg"),
            ("no_extension", "no_extension"),
            ("trailing_dot..png", "trailing_dot.png"),
            ("", "image.jpg"),
            (":::???***.jpg", "image.jpg"),
        ]
        for raw, expected in cases:
            cleaned = sanitize_filename(raw, fallback="image.jpg")
            assert cleaned == expected, f"Failed for raw={raw}: got {cleaned}, expected {expected}"
            # Test writing, part file writing, and atomic renaming (which failed on Windows with WinError 87)
            fpath = os.path.join(temp_folder, cleaned)
            part_path = fpath + ".part"
            with open(part_path, "wb") as f:
                f.write(b"payload")
            os.replace(part_path, fpath)
            assert os.path.exists(fpath)
            assert os.path.getsize(fpath) == 7

    def test_safe_ensure_dir(self, temp_folder):
        nested = os.path.join(temp_folder, "a", "b", "c")
        out = safe_ensure_dir(nested)
        assert os.path.isdir(out)
        assert os.path.isdir(nested)

    def test_safe_filepath(self, temp_folder):
        target_dir = os.path.join(temp_folder, "sub:dir_test")
        safe_path, safe_name = safe_filepath(target_dir, "re:zero_test.jpg")
        assert ":" not in safe_name
        with open(safe_path, "w") as f:
            f.write("content")
        assert os.path.isfile(safe_path)


class TestWorkerFolderBuildingWithProhibitedChars:
    """Test that every worker properly creates its tag folder and subfolders

    even when the tag or query contains colons (:) or other prohibited characters.
    """

    NET_CONFIG = {
        "anti_ban_pause": 0.0,
        "download_retries": 1,
        "use_proxy": False,
        "api_timeout": 5,
    }

    def test_danbooru_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = DanbooruWorker("re:zero", 10, "", [], self.NET_CONFIG)
        assert os.path.isdir(w.tag_dir)
        rel = os.path.relpath(w.tag_dir, str(tmp_path))
        assert ":" not in rel

    def test_gelbooru_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = GelbooruWorker("86: Eighty Six", 10, "", [], self.NET_CONFIG)
        assert os.path.isdir(w.tag_dir)
        rel = os.path.relpath(w.tag_dir, str(tmp_path))
        assert ":" not in rel

    def test_konachan_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = KonachanWorker("re:zero", 10, "", [], self.NET_CONFIG)
        assert os.path.isdir(w.tag_dir)
        rel = os.path.relpath(w.tag_dir, str(tmp_path))
        assert ":" not in rel

    def test_yande_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = YandeWorker("fate/stay_night:unlimited", 10, "", self.NET_CONFIG)
        assert os.path.isdir(w.tag_dir)
        rel = os.path.relpath(w.tag_dir, str(tmp_path))
        assert ":" not in rel

    def test_safebooru_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = SafebooruWorker("tag:with:colons", 10, [], self.NET_CONFIG)
        assert os.path.isdir(w.tag_dir)
        rel = os.path.relpath(w.tag_dir, str(tmp_path))
        assert ":" not in rel

    def test_sankaku_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = SankakuWorker("character:rem_(re:zero)", 10, "", [], self.NET_CONFIG)
        assert os.path.isdir(w.tag_dir)
        rel = os.path.relpath(w.tag_dir, str(tmp_path))
        assert ":" not in rel

    def test_anime_dl_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = AnimeDlWorker("re:zero", 10, self.NET_CONFIG)
        assert os.path.isdir(w.tag_dir)
        rel = os.path.relpath(w.tag_dir, str(tmp_path))
        assert ":" not in rel

    def test_eshuushuu_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = EShuushuuWorker("re:zero", 10, [], "", self.NET_CONFIG)
        assert os.path.isdir(w.tag_dir)
        rel = os.path.relpath(w.tag_dir, str(tmp_path))
        assert ":" not in rel

    def test_rule34_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = Rule34Worker("re:zero", 10, "and", "id", "desc", [], self.NET_CONFIG)
        assert os.path.isdir(w.tag_dir)
        rel = os.path.relpath(w.tag_dir, str(tmp_path))
        assert ":" not in rel

    def test_pixiv_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = PixivWorker("artworks:re:zero", 10, "", [], self.NET_CONFIG)
        assert os.path.isdir(w.tag_dir)
        rel = os.path.relpath(w.tag_dir, str(tmp_path))
        assert ":" not in rel

    def test_nekos_best_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = NekosBestWorker("cat:neko?", 10, self.NET_CONFIG)
        assert os.path.isdir(w.cat_dir)
        rel = os.path.relpath(w.cat_dir, str(tmp_path))
        assert ":" not in rel

    def test_nekos_life_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = NekosLifeWorker("neko:special", 10, self.NET_CONFIG)
        assert os.path.isdir(w.site_root)
        assert ":" not in w.safe_category

    def test_nekosapi_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = NekosApiWorker("re:zero,neko:tail", 10, "safe", self.NET_CONFIG)
        assert os.path.isdir(w.rating_dir)
        rel = os.path.relpath(w.tag_dir, str(tmp_path))
        assert ":" not in rel

    def test_nekosia_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = NekosiaWorker("re:zero", 10, "safe", self.NET_CONFIG)
        assert os.path.isdir(w.rating_dir)
        rel = os.path.relpath(w.tag_dir, str(tmp_path))
        assert ":" not in rel

    def test_waifu_im_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = WaifuImWorker("re:zero", 10, False, self.NET_CONFIG)
        assert os.path.isdir(w.tag_dir)
        rel = os.path.relpath(w.tag_dir, str(tmp_path))
        assert ":" not in rel

    def test_pinterest_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = PinterestWorker("re:zero pins", 10, True, self.NET_CONFIG)
        assert os.path.isdir(w.site_root)
        rel = os.path.relpath(w.site_root, str(tmp_path))
        assert ":" not in rel

    def test_zerochan_worker_folder(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        w = ZerochanWorker("Rem (Re:Zero)", 10, self.NET_CONFIG)
        assert os.path.isdir(w.tag_dir)
        rel = os.path.relpath(w.tag_dir, str(tmp_path))
        assert ":" not in rel


class TestBaseDownloaderEnqueueWithProhibitedChars:
    def test_enqueue_download_sanitizes_prohibited_characters(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        dl = BaseDownloader("test_worker", "Test:Site", 10, {"anti_ban_pause": 0})
        dl.download_queue = asyncio.Queue()

        async def _run():
            unsafe_dir = os.path.join(dl.site_root, "tag:with:colons")
            unsafe_filename = "re:zero_image*<1>.png"
            unsafe_filepath = os.path.join(unsafe_dir, unsafe_filename)

            enqueued = await dl.enqueue_download("http://example.com/img.png", unsafe_filepath, unsafe_filename, ["re:zero"])
            assert enqueued is True
            item = dl.download_queue.get_nowait()
            q_url, q_filepath, q_filename, q_tags, *_ = item

            assert ":" not in q_filename
            assert "*" not in q_filename
            assert "<" not in q_filename
            assert ">" not in q_filename
            rel_dir = os.path.relpath(os.path.dirname(q_filepath), str(tmp_path))
            assert ":" not in rel_dir
            assert os.path.isdir(os.path.dirname(q_filepath))

        asyncio.run(_run())

    def test_async_download_file_completes_with_prohibited_char_path(self, monkeypatch, tmp_path):
        monkeypatch.setattr("core.shared.MASTER_FOLDER", str(tmp_path))
        dl = BaseDownloader("test_worker", "Test:Site", 10, {"anti_ban_pause": 0, "download_retries": 1})

        # Create a mock aiohttp session and response
        class MockContent:
            async def iter_chunked(self, n):
                yield b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xff\xdb\x00C\x00" + b"\x00" * 100 + b"\xff\xd9"

        class MockResponse:
            def __init__(self):
                self.content = MockContent()
                self.headers = {"Content-Length": "127"}
            def raise_for_status(self):
                pass
            async def __aenter__(self):
                return self
            async def __aexit__(self, exc_type, exc_val, exc_tb):
                pass

        class MockSession:
            def __init__(self):
                self.headers = {}
            def get(self, *args, **kwargs):
                return MockResponse()

        dl.session = MockSession()

        async def _run_download():
            folder = os.path.join(dl.site_root, "Safe_Tag")
            safe_ensure_dir(folder)
            safe_path, safe_name = safe_filepath(folder, "re:zero_test.jpg")
            
            ok = await dl._async_download_file(
                url="http://example.com/fake.jpg",
                filepath=safe_path,
                filename=safe_name,
                tags_list=["re:zero", "rem"],
                artists=["test_artist"],
            )
            assert ok is True
            assert os.path.isfile(safe_path)
            assert safe_name in dl.dl_history

        asyncio.run(_run_download())
