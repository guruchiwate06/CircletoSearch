import sys
from PySide6.QtWidgets import QApplication, QLabel, QMainWindow
from PySide6.QtCore import Qt


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("ScreenLens")
        self.setMinimumSize(400, 200)

        label = QLabel("ScreenLens is running")
        label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setCentralWidget(label)


def main():
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
