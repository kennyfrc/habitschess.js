const FenReader = require('./fen.js').FenReader;
const BitHelper = require('./helpers.js').BitHelper;
const PieceBoard = require('./pieceboard.js').PieceBoard;
const PieceBoardList = require('./pieceboard.js').PieceBoardList;
const ViewHelper = require('./helpers.js').ViewHelper;
const SquareHelper = require('./helpers.js').SquareHelper;
const U64 = require('./helpers.js').U64;
const Pieces = require('./pieces.js').Pieces;
const MoveList = require('./move.js').MoveList;
const ThreatBoard = require('./threatboard.js').ThreatBoard;

class Board {
  constructor() {
    // basic bitboards
    this.bb = U64(0);
    this.whiteBb = U64(0);
    this.blackBb = U64(0);
    this.whiteKingBb = U64(0);
    this.blackKingBb = U64(0);
    this.whitePawnBb = U64(0);
    this.blackPawnBb = U64(0);
    this.whiteKnightBb = U64(0);
    this.blackKnightBb = U64(0);
    this.whiteBishopBb = U64(0);
    this.blackBishopBb = U64(0);
    this.whiteRookBb = U64(0);
    this.blackRookBb = U64(0);
    this.whiteQueenBb = U64(0);
    this.blackQueenBb = U64(0);
    this.whiteMinorBb = U64(0);
    this.blackMinorBb = U64(0);
    this.whiteMajorBb = U64(0);
    this.blackMajorBb = U64(0);

    // piece knowledge
    this.pieceBoardList = new PieceBoardList();

    // data for check evasion
    this.kingDangerSqsBb = U64(0);
    this.sideInCheck = false;
    this.checkersBb = U64(0);
    this.checkerCount = 0;
    this.checkingPiece;

    // data for pins and xrays
    this.whiteBlockers = U64(0);
    this.blackBlockers = U64(0);
    this.blockers = U64(0);

    // data for en passant
    this.epSqIdx = undefined;
    this.epSqBb = U64(0);
    this.epCaptureBb = U64(0);

    // other critical data
    this.castleStatus = U64(0);
    this.castleBit = {'K': U64('0x1'), 'Q': U64('0x80'), 'k': U64('0x100000000000000'), 'q': U64('0x8000000000000000')};
    this.whiteToMove = true;
    this.moveBit = {'w': U64(1), 'b': U64(0)};
    this.halfMoveClock = 0;
    this.fullMoveNo = 0;
  }

  parseFenToBoard(fen) {
    this.resetBoard();

    let boardIndex = 56; // fens start at a8
    let ranksRead = 1;
    let whiteSpace = 0;

    for (let i = 0; i < fen.length; i++) {
      if (FenReader.finishedReadingBoard(ranksRead, whiteSpace)) {
        if (FenReader.isSidetoMove(fen[i])) {
          this.whiteToMove = fen[i] === 'w' ? true : false;
        }

        if (FenReader.isCastlingSymbol(fen[i])) {
          this.castleStatus |= this.castleBit[fen[i]];
        }

        if (FenReader.isEnPassantChar(fen[i], whiteSpace)) {
          let epSq = fen[i] + fen[i+1]
          this.epSqIdx = SquareHelper.for(epSq);
          this.epSqBb = BitHelper.setBit(U64(0), this.epSqIdx);
          this.epCaptureBb = this.getEpCaptureBb();
          i += 1;
        }

        /**
         * TODO: There will be an external class that decides whether
         * a pawn is advanced or there was a capture
         * both of the above require move history
         **/
        if (FenReader.isHalfMoveClock(fen[i], whiteSpace)) {
          if (FenReader.isSpace(fen[i+1])) {
            this.halfMoveClock = parseInt(fen[i]);
          } else {
            this.halfMoveClock = parseInt(fen[i] + fen[i+1]);
            i += 1;
          }
        }

        if (FenReader.isFullMoveNo(fen[i], whiteSpace)) {
          if (FenReader.isUndefined(fen[i+1])) {
              this.fullMoveNo = parseInt(fen[i]);
            } else {
              this.fullMoveNo = parseInt(fen[i] + fen[i+1]);
              i += 1; 
          }
        }
      } else {
        if (FenReader.isWhitePiece(fen[i])) {
          const pieceBit = BitHelper.setBit(this.pieceBoardList[fen[i]].bb, boardIndex);
          this.pieceBoardList[fen[i]] = PieceBoard.for(fen[i], pieceBit);
          boardIndex += 1;
        }

        if (FenReader.isBlackPiece(fen[i])) {
          const pieceBit = BitHelper.setBit(this.pieceBoardList[fen[i]].bb, boardIndex);
          this.pieceBoardList[fen[i]] = PieceBoard.for(fen[i], pieceBit);
          boardIndex += 1;
        }

        if (FenReader.isEmptySquare(fen[i])) {
          boardIndex += parseInt(fen[i]);
        }

        if (FenReader.isNewRank(fen[i])) {
          boardIndex = (56 - (ranksRead * 8));
          ranksRead += 1;
        }
      }
      if (FenReader.isSpace(fen[i])) {
        whiteSpace += 1;
      }
    }

    this.setPieceBbs();
    this.setPieceSetBbs();
    this.setBoardBb();
    this.setInCheck();
    this.setCheckerCount();
    this.setBlockers();
  }

  resetBoard() {
    this.pieceBoardList = new PieceBoardList();
  }

  /**
   * A8 = 56 thus, that's where we do the exclusive xor (where you flip)
   * you might need to flip the main boards first
   */
  flipBoard() {
    for (let sq = 0; sq < 32; sq++) {
      for (const [piece, pboard] of Object.entries(this.pieceBoardList)) {
        const bit = BitHelper.getBit(pboard.bb, sq);
        const invertedBit = BitHelper.getBit(pboard.bb, sq ^ 56);
        pboard.bb = BitHelper.updateBit(pboard.bb, sq, invertedBit);
        pboard.bb = BitHelper.updateBit(pboard.bb, sq ^ 56, bit);
        this.pieceBoardList[piece] = pboard;
      }
    }
  }

  setPieceBbs() {
    this.whiteKingBb |= this.pieceBoardList.K.bb;
    this.blackKingBb |= this.pieceBoardList.k.bb;
    this.whiteQueenBb |= this.pieceBoardList.Q.bb;
    this.blackQueenBb |= this.pieceBoardList.q.bb;
    this.whiteRookBb |= this.pieceBoardList.R.bb;
    this.blackRookBb |= this.pieceBoardList.r.bb;
    this.whiteBishopBb |= this.pieceBoardList.B.bb;
    this.blackBishopBb |= this.pieceBoardList.b.bb;
    this.whiteKnightBb |= this.pieceBoardList.N.bb;
    this.blackKnightBb |= this.pieceBoardList.n.bb;
    this.whitePawnBb |= this.pieceBoardList.P.bb;
    this.blackPawnBb |= this.pieceBoardList.p.bb;
  }

  setPieceSetBbs() {
    this.whiteMajorBb = this.whiteRookBb | this.whiteQueenBb;
    this.whiteMinorBb = this.whiteKnightBb | this.whiteBishopBb;
    this.whiteBb = this.whiteMajorBb | this.whiteMinorBb | this.whitePawnBb |
      this.whiteKingBb;
    this.blackMajorBb = this.blackRookBb | this.blackQueenBb;
    this.blackMinorBb = this.blackKnightBb | this.blackBishopBb;
    this.blackBb = this.blackMajorBb | this.blackMinorBb | this.blackPawnBb |
      this.blackKingBb;
  }

  setBoardBb() {
    this.bb = this.whiteBb | this.blackBb;
  }

  setInCheck() {
    this.kingDangerSqsBb = this.whiteToMove ? this.kingDangerBb('w') :
      this.kingDangerBb('b');
    const kingBb = this.whiteToMove ? this.whiteKingBb : this.blackKingBb;
    this.sideInCheck = (this.kingDangerSqsBb & kingBb) !== U64(0) ? true : false;
  }

  setCheckerCount() {
    this.checkerCount = this.sideInCheck ? BitHelper.popCount(this.checkersBb) : 0;
  }

  setCheckers(threats, fenPiece, pieceBb, boardProxyNoKing) {
    const kingBb = boardProxyNoKing.whiteToMove ? boardProxyNoKing.whiteKingBb : boardProxyNoKing.blackKingBb;
    this.checkersBb |= (threats & kingBb) !== U64(0) ? pieceBb : U64(0);
    this.checkingPiece = (threats & kingBb) !== U64(0) ? fenPiece : undefined;
  }

  setBlockers() {
    const opponentsSide = this.whiteToMove ? 'bs' : 'ws';
    const blockers = ThreatBoard.for(opponentsSide, this) & this.bb;
    this.whiteBlockers = blockers & this.whiteBb;
    this.blackBlockers = blockers & this.blackBb;
    this.blockers = blockers;
  }

  getEpCaptureBb() {
    return this.whiteToMove ? this.epSqBb >> U64(8) : this.epSqBb << U64(8);
  }

  getBlockers() {
    return this.blockers;
  }

  legalMoves() {
    return MoveList.legalMoves(this);
  }

  moves(fenPiece = 'all') {
    return fenPiece ? MoveList.for(fenPiece, this) : MoveList.legalMoves(this);
  }

  xrayDangerBb() {
    return ThreatBoard.xrayDangerSqs(this); 
  }

  kingDangerBb(side) {
    return ThreatBoard.kingDangerSqs(side, this);
  }

  isSqAttacked(sq, byPieceOrSide = 'all') {
    return BoardStatus.isSqAttacked(this, sq, byPieceOrSide);
  }

  isOurKingXrayed() {
    return BoardStatus.isOurKingXrayed(this);
  }

  isOurPiecePinnedToKing() {
    return BoardStatus.isOurPiecePinnedToKing(this);
  }

  isInCheck() {
    return BoardStatus.isInCheck(this);
  }
}

class BoardStatus {
  static isSqAttacked(board, sq, byPieceOrSide = 'all') {
    const targetSq = BitHelper.setBit(U64(0), sq);
    const attacks = ThreatBoard.for(byPieceOrSide, board);
    return (targetSq & attacks) === U64(0) ? false : true;
  }

  static isOurKingXrayed(board) {
    const ourKingFen = board.whiteToMove ? 'K' : 'k';
    const ourKing = board.pieceBoardList[ourKingFen].bb;
    const opponentXrays = board.xrayDangerBb();
    return (ourKing & opponentXrays) !== U64(0) ? true : false;
  }

  static isOurPiecePinnedToKing(board) {
    const ourBb = board.whiteToMove ? board.whiteBb : board.blackBb;
    const blockers = board.getBlockers();
    return (ourBb & blockers) !== U64(0) ? true : false;
  }

  static isInCheck(board) {
    return board.sideInCheck;
  }
}

module.exports = {
  Board: Board,
};
