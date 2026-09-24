import os
import tempfile
import shutil
import pytest
from PIL import Image
from core.dedup_store import DedupStore, compute_signature, PureHash
from core.shared import check_duplicate, remove_gallery_files
from core.database import SettingsManager, get_settings


class TestDedupStore:
    @pytest.fixture
    def dedup_env(self):
        tmp_dir = tempfile.mkdtemp()
        db_path = os.path.join(tmp_dir, "test_dedup.sqlite3")
        store = DedupStore(db_path=db_path)
        yield store, tmp_dir
        store.close()
        shutil.rmtree(tmp_dir)

    def test_pure_hash_operations(self):
        h1 = PureHash(0x0000, bits=64)
        h2 = PureHash(0x000F, bits=64)
        assert (h1 - h2) == 4
        assert str(h1) == "0000000000000000"
        assert str(h2) == "000000000000000f"
        assert int(h2) == 15

    def test_add_and_duplicate_detection(self, dedup_env):
        store, tmp_dir = dedup_env

        img1_path = os.path.join(tmp_dir, "img1.png")
        img = Image.new("RGB", (300, 300), color=(100, 150, 200))
        img.save(img1_path)

        res1 = store.check_and_add(img1_path, site="danbooru", post_id="101")
        assert not res1.is_duplicate
        assert store.count() == 1

        # Identical file check
        res2 = store.check_and_add(img1_path, site="gelbooru", post_id="202")
        assert res2.is_duplicate
        assert res2.matched_path == img1_path

        # Resized and JPEG-compressed variant (re-encoded)
        img2_path = os.path.join(tmp_dir, "img2.jpg")
        img.resize((150, 150)).save(img2_path, "JPEG", quality=80)
        res3 = store.check_and_add(img2_path, site="zerochan", post_id="303")
        assert res3.is_duplicate
        assert res3.matched_path == img1_path

        # Different image
        img3_path = os.path.join(tmp_dir, "img3.png")
        diff_img = Image.new("RGB", (300, 300), color=(20, 200, 50))
        for x in range(50, 150):
            for y in range(50, 150):
                diff_img.putpixel((x, y), (255, 0, 0))
        diff_img.save(img3_path)
        res4 = store.check_and_add(img3_path, site="pixiv", post_id="404")
        assert not res4.is_duplicate
        assert store.count() == 2

    def test_ghost_pruning_on_deleted_file(self, dedup_env):
        store, tmp_dir = dedup_env

        temp_img_path = os.path.join(tmp_dir, "temp_img.png")
        Image.new("RGB", (200, 200), color=(80, 80, 180)).save(temp_img_path)

        res1 = store.check_and_add(temp_img_path, site="danbooru")
        assert not res1.is_duplicate
        assert store.count() == 1

        # Delete the file from disk (as if user removed it)
        os.remove(temp_img_path)

        # Now try to add a new file that has the exact same image
        new_img_path = os.path.join(tmp_dir, "new_img.png")
        Image.new("RGB", (200, 200), color=(80, 80, 180)).save(new_img_path)

        # Because the old file is gone, ghost record should be pruned and new file allowed
        res2 = store.check_and_add(new_img_path, site="danbooru")
        assert not res2.is_duplicate
        assert store.count() == 1

    def test_remove_by_filepath(self, dedup_env):
        store, tmp_dir = dedup_env
        p = os.path.join(tmp_dir, "test.png")
        Image.new("RGB", (100, 100), color=(10, 20, 30)).save(p)
        store.check_and_add(p)
        assert store.count() == 1
        store.remove_by_filepath(p)
        assert store.count() == 0

    def test_remove_missing_files(self, dedup_env):
        store, tmp_dir = dedup_env
        p1 = os.path.join(tmp_dir, "keep.png")
        p2 = os.path.join(tmp_dir, "remove.png")
        Image.new("RGB", (100, 100), color=(1, 2, 3)).save(p1)
        Image.new("RGB", (100, 100), color=(4, 5, 6)).save(p2)
        store.check_and_add(p1)
        store.check_and_add(p2)
        assert store.count() == 2
        os.remove(p2)
        swept = store.remove_missing_files()
        assert swept == 1
        assert store.count() == 1
        # Second run is idempotent
        assert store.remove_missing_files() == 0

    def test_settings_toggle(self, tmp_path, monkeypatch):
        store = DedupStore(os.path.join(tmp_path, "toggle.sqlite3"))
        monkeypatch.setattr("core.dedup_store.get_store", lambda: store)

        # When dedup_enabled is False, check_duplicate should return None immediately
        settings = get_settings()
        settings.update({"dedup_enabled": False})
        img_path = os.path.join(tmp_path, "sample.png")
        Image.new("RGB", (50, 50), color="blue").save(img_path)
        result = check_duplicate(img_path, "test")
        assert result is None

        # When dedup_enabled is True, it performs dedup
        settings.update({"dedup_enabled": True})
        result1 = check_duplicate(img_path, "test")
        assert result1 is not None
        assert not result1.is_duplicate

        # Adding same image again should be detected as duplicate
        result2 = check_duplicate(img_path, "test")
        assert result2 is not None
        assert result2.is_duplicate

    def test_corrupt_file_graceful_handling(self, dedup_env):
        store, tmp_dir = dedup_env
        corrupt_path = os.path.join(tmp_dir, "corrupt.jpg")
        with open(corrupt_path, "wb") as f:
            f.write(b"not an image file data")
        res = store.check_and_add(corrupt_path)
        assert not res.is_duplicate

    def test_palette_swap_rejection(self, dedup_env):
        store, tmp_dir = dedup_env
        # Original blue image
        orig_path = os.path.join(tmp_dir, "blue.png")
        Image.new("RGB", (200, 200), color=(30, 80, 240)).save(orig_path)
        res1 = store.check_and_add(orig_path)
        assert not res1.is_duplicate

        # Palette-swapped red image with identical structure/shape
        swap_path = os.path.join(tmp_dir, "red.png")
        Image.new("RGB", (200, 200), color=(240, 80, 30)).save(swap_path)
        res2 = store.check_and_add(swap_path)
        assert not res2.is_duplicate
        assert store.count() == 2

    def test_concurrent_access_thread_safety(self, dedup_env):
        import threading
        store, tmp_dir = dedup_env
        errors = []

        def worker(idx):
            try:
                p = os.path.join(tmp_dir, f"thread_{idx}.png")
                Image.new("RGB", (50, 50), color=(idx * 20 % 255, 100, 150)).save(p)
                store.check_and_add(p, site=f"site_{idx}")
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(15)]
        for t in threads: t.start()
        for t in threads: t.join()

        assert len(errors) == 0
        assert store.count() > 0
